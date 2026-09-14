const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const DiffMatchPatch = require('diff-match-patch');
const dmp = new DiffMatchPatch();

const app = express();
app.use(express.static(__dirname));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const docs = {};

function getDoc(room) {
  if (!docs[room]) docs[room] = { title: '', content: '', comments: [] };
  return docs[room];
}

app.get('/api/doc/:room', (req, res) => res.json(getDoc(req.params.room)));

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const room = url.searchParams.get('room');
  const name = url.searchParams.get('name') || '访客';
  if (!room) return ws.close();

  ws.room = room;
  ws.name = name;
  ws.clientId = Math.random().toString(36).slice(2, 10);
  ws.typing = false;

  if (!wss.rooms) wss.rooms = {};
  if (!wss.rooms[room]) wss.rooms[room] = new Set();
  wss.rooms[room].add(ws);

  const doc = getDoc(room);
  ws.send(JSON.stringify({
    type: 'init',
    clientId: ws.clientId,
    selfName: name,
    doc: doc,
    peers: Array.from(wss.rooms[room]).map(c => ({ id: c.clientId, name: c.name, typing: !!c.typing }))
  }));

  broadcastPeers(room);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const from = ws.clientId;

    if (msg.type === 'op') {
      try {
        const patches = dmp.patch_fromText(msg.patch);
        const result = dmp.patch_apply(patches, doc.content);
        const newText = result[0];
        const ok = result[1].every(r => r);
        if (ok) {
          doc.content = newText;
          broadcast(room, { type: 'op', patch: msg.patch, from }, ws);
        } else {
          /* 应用失败：把当前权威内容推回给发消息的人 */
          ws.send(JSON.stringify({ type: 'resync', content: doc.content }));
        }
      } catch (e) {}
    } else if (msg.type === 'title') {
      doc.title = String(msg.title || '');
      broadcast(room, { type: 'title', title: doc.title, from }, ws);
    } else if (msg.type === 'typing') {
      ws.typing = !!msg.active;
      broadcastPeers(room);
    } else if (msg.type === 'comment:add') {
      const c = {
        id: Math.random().toString(36).slice(2, 12),
        quote: msg.comment && msg.comment.quote,
        text: msg.comment && msg.comment.text,
        author: (msg.comment && msg.comment.name) || ws.name,
        clientId: from,
        resolved: false,
        createdAt: Date.now()
      };
      doc.comments.push(c);
      broadcast(room, { type: 'comment:add', comment: c, from }, null);
    } else if (msg.type === 'comment:resolve') {
      const c = doc.comments.find(x => x.id === msg.id);
      if (c) {
        c.resolved = msg.resolved;
        broadcast(room, { type: 'comment:update', comment: c, from }, null);
      }
    } else if (msg.type === 'comment:delete') {
      doc.comments = doc.comments.filter(x => x.id !== msg.id);
      broadcast(room, { type: 'comment:delete', id: msg.id, from }, null);
    }
  });

  ws.on('close', () => {
    const set = wss.rooms && wss.rooms[room];
    if (set) {
      set.delete(ws);
      if (set.size === 0) delete wss.rooms[room];
    }
    broadcastPeers(room);
  });
});

function broadcast(room, msg, except) {
  const set = wss.rooms && wss.rooms[room];
  if (!set) return;
  const data = JSON.stringify(msg);
  set.forEach(c => { if (c !== except && c.readyState === 1) c.send(data); });
}

function broadcastPeers(room) {
  const set = wss.rooms && wss.rooms[room];
  if (!set) return;
  const peers = Array.from(set).map(c => ({ id: c.clientId, name: c.name, typing: !!c.typing }));
  const data = JSON.stringify({ type: 'peers', peers });
  set.forEach(c => { if (c.readyState === 1) c.send(data); });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('服务运行中，端口 ' + PORT));
