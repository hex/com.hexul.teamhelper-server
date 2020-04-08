const express = require('express');
const path = require('path');
const {
  createServer
} = require('http');
const WebSocket = require('ws');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const url = require('url');

const adapter = new FileSync('db.json');
const db = low(adapter);

const app = express();

const server = createServer(app);
const wss = new WebSocket.Server({
  server
});

function noop() {
}

function heartbeat() {
  this.isAlive = true;
}

db.defaults({
  users: []
}).write();

const users = db.get('users');

wss.on('connection', function (ws, req) {
  const parameters = url.parse(req.url, true);
  // ws.clientId = req.headers['sec-websocket-key'];
  ws.clientId = parameters.query.clientId;
  ws.clientName = parameters.query.clientName;
  ws.channel = parameters.query.channel;
  ws.lockedAsset = "";
  ws.hasSceneRequest = false;
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  console.log("-------------------------------------------");
  console.log("Client " + ws.clientId + " > " + ws.clientName + " joined: " + ws.channel);

  const user = users
    .find({
      id: ws.clientId
    })
    .value();

  if (user === undefined) {
    users.push({
      user: ws.clientName,
      id: ws.clientId,
      onScene: false,
      isOnline: true,
      lockedAsset: "",
      hasSceneRequest: false
    }).write().id;
  } else {
    users.find({
      id: ws.clientId
    }).assign({
      isOnline: true
    }).write();

    ws.onScene = users.find({
      id: ws.clientId
    }).value().onScene;
  }

  updateClients(ws);

  ws.on('message', function (data) {
    const msgType = data.substr(0, data.indexOf(':'));
    const msgData = data.split(':').pop();

    console.log(ws.clientName + " sent " + data);

    switch (msgType) {
      case "request":
        if (msgData === "scene") {
          checkSceneStatus(ws);
        }
        break;

      case "object":
        lockObject(ws, msgData);
        break;
    }

  });

  ws.on('close', function () {
    console.log("Client " + ws.clientName + " left.");
    users.find({
      id: ws.clientId
    }).assign({
      isOnline: false
    }).write();
    updateClients(ws);
  });
});

const sceneInterval = setInterval(function ping() {
  let dbUsers = db.get('users').value();

  dbUsers.forEach(function each(dbuser) {
    console.log("Check user: " + dbuser.id);
    if (!dbuser.isOnline && dbuser.onScene) {
      console.log("Found inactive user on scene: " + dbuser.id);
      db.get('users').find({
        id: dbuser.id
      }).assign({
        onScene: false
      }).write();
    }
  });
}, 300000);

const pingInterval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) {
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping(noop);
  });
}, 2000);

wss.on('close', function close() {
  const newState = {};
  db.setState(newState);
  clearInterval(pingInterval);
  clearInterval(sceneInterval);
});

function lockObject(ws, data) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN && ws.channel === client.channel) {
      ws.lockedAsset = data;
      users.find({
        id: ws.clientId
      }).assign({
        lockedAsset: data
      }).write();
    }
  });

  updateClients(ws);
}

function checkSceneStatus(ws) {
  let isSceneFree = true;
  let clientOnSceneId;

  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN && ws.channel === client.channel) {
      if (client.onScene === true) {
        clientOnSceneId = client.clientId;
        if (client.clientId === ws.clientId) {
          isSceneFree = true;
        } else {
          isSceneFree = false;

          const sceneRequestStatus = users.find({
            id: ws.clientId
          }).value().hasSceneRequest;

          ws.hasSceneRequest = sceneRequestStatus ? false : true
          users.find({
            id: ws.clientId
          }).assign({
            hasSceneRequest: ws.hasSceneRequest
          }).write();

          if(ws.hasSceneRequest)
            client.send( JSON.stringify({requestUser: ws.clientName}));

        }
        console.log("Scene locked by: " + client.clientName);
      }
    }
  });

  if (isSceneFree && clientOnSceneId !== ws.clientId) {
    ws.onScene = true;
    ws.hasSceneRequest = false;
    users.find({
      id: ws.clientId
    }).assign({
      onScene: true,
      hasSceneRequest: false
    }).write();
  } else {
    ws.onScene = false;

    users.find({
      id: ws.clientId
    }).assign({
      onScene: false
    }).write();
  }

  updateClients(ws);
}

function updateClients(ws) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN && ws.channel === client.channel) {
      const clientList = JSON.stringify(
        Array.from(wss.clients)
          .filter(c => c.channel === ws.channel)
          .map(entry => ({
            id: entry.clientId,
            user: entry.clientName,
            channel: entry.channel,
            lockedAsset: users.find({
              id: entry.clientId
            }).value().lockedAsset,
            onScene: users.find({
              id: entry.clientId
            }).value().onScene,
            hasSceneRequest: users.find({
              id: entry.clientId
            }).value().hasSceneRequest,
            isOnline: entry.isOnline
          })));
      client.send(clientList);
    }
  });
}

server.listen(6666, function () {
  console.log('Listening on http://localhost:6666');
});