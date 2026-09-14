const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

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

  if (!wss.rooms) wss.rooms = {};
  if (!wss.rooms[room]) wss.rooms[room] = new Set();
  wss.rooms[room].add(ws);

  const doc = getDoc(room);

  ws.send(JSON.stringify({
    type: 'init',
    clientId: ws.clientId,
    selfName: name,
    doc: doc,
    peers: Array.from(wss.rooms[room]).map(c => ({ id: c.clientId, name: c.name }))
  }));

  broadcastPeers(room);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    msg.from = ws.clientId;

    if (msg.type === 'text') {
      doc.content = msg.content;
      broadcast(room, msg, ws);
    } else if (msg.type === 'title') {
      doc.title = msg.title;
      broadcast(room, msg, ws);
    } else if (msg.type === 'comment:add') {
      const c = {
        id: Math.random().toString(36).slice(2, 12),
        quote: msg.comment.quote,
        text: msg.comment.text,
        author: msg.comment.name || ws.name,
        clientId: ws.clientId,
        resolved: false,
        createdAt: Date.now()
      };
      doc.comments.push(c);
      broadcast(room, { type: 'comment:add', comment: c, from: ws.clientId }, null);
    } else if (msg.type === 'comment:resolve') {
      const c = doc.comments.find(x => x.id === msg.id);
      if (c) {
        c.resolved = msg.resolved;
        broadcast(room, { type: 'comment:update', comment: c, from: ws.clientId }, null);
      }
    } else if (msg.type === 'comment:delete') {
      doc.comments = doc.comments.filter(x => x.id !== msg.id);
      broadcast(room, { type: 'comment:delete', id: msg.id, from: ws.clientId }, null);
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
  set.forEach(c => {
    if (c !== except && c.readyState === 1) c.send(data);
  });
}

function broadcastPeers(room) {
  const set = wss.rooms && wss.rooms[room];
  if (!set) return;
  const peers = Array.from(set).map(c => ({ id: c.clientId, name: c.name }));
  set.forEach(c => {
    if (c.readyState === 1) c.send(JSON.stringify({ type: 'peers', peers }));
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('服务运行中，端口 ' + PORT));