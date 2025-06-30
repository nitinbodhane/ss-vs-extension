const vscode = require('vscode');
const { Room, Track, RoomEvent } = require('livekit-client');
const { TextEncoder, TextDecoder } = require('util'); // Added for Node.js compatibility

let currentPanel = undefined;
let room = undefined;

function activate(context) {
  let disposable = vscode.commands.registerCommand(
    "livekit-vscode-chat.openChat",
    async function () {
      if (currentPanel) {
        currentPanel.reveal();
        return;
      }

      currentPanel = vscode.window.createWebviewPanel(
        "livekitChat",
        "LiveKit Chat",
        vscode.ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [], // Add any local resource roots if needed
        }
      );

      const webviewContent = getWebviewContent();
      currentPanel.webview.html = webviewContent;

      // Handle messages from the webview
      currentPanel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case "connect":
              await connectToRoom(message.server, message.token);
              return;
            case "sendMessage":
              if (room) {
                await room.localParticipant.publishData(
                  new TextEncoder().encode(message.text),
                  { topic: "chat" }
                );
              }
              return;
            case "screenShare":
              if (room) {
                await toggleScreenShare();
              }
              return;
          }
        },
        undefined,
        context.subscriptions
      );

      currentPanel.onDidDispose(
        () => {
          if (room) {
            room.disconnect();
            room = undefined;
          }
          currentPanel = undefined;
        },
        null,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(disposable);
}

function getWebviewContent() {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LiveKit Chat</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        padding: 10px;
        margin: 0;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
      }
      #chat-container {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      #messages {
        flex-grow: 1;
        overflow-y: auto;
        margin-bottom: 10px;
        border: 1px solid var(--vscode-input-border);
        padding: 10px;
        border-radius: 4px;
      }
      #input-area {
        display: flex;
        gap: 10px;
      }
      #message-input {
        flex-grow: 1;
        padding: 8px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
      }
      button {
        padding: 8px 16px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
      button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      #connection-info {
        margin-bottom: 10px;
      }
      .message {
        margin-bottom: 8px;
      }
      .participant {
        font-weight: bold;
        color: var(--vscode-textPreformat-foreground);
      }
    </style>
  </head>
  <body>
    <div id="chat-container">
      <div id="connection-info">
        <input id="server-url" type="text" placeholder="LiveKit Server URL" value="wss://your-livekit-server.com">
        <input id="token" type="text" placeholder="Access Token">
        <button id="connect-btn">Connect</button>
        <button id="screen-share-btn">Toggle Screen Share</button>
        <div id="status">Not connected</div>
      </div>
      
      <div id="messages"></div>
      
      <div id="input-area">
        <input id="message-input" type="text" placeholder="Type your message...">
        <button id="send-btn">Send</button>
      </div>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      
      document.getElementById('connect-btn').addEventListener('click', () => {
        const server = document.getElementById('server-url').value;
        const token = document.getElementById('token').value;
        vscode.postMessage({
          command: 'connect',
          server: server,
          token: token
        });
      });
      
      document.getElementById('send-btn').addEventListener('click', () => {
        const input = document.getElementById('message-input');
        const message = input.value;
        if (message) {
          vscode.postMessage({
            command: 'sendMessage',
            text: message
          });
          input.value = '';
        }
      });
      
      document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          document.getElementById('send-btn').click();
        }
      });
      
      document.getElementById('screen-share-btn').addEventListener('click', () => {
        vscode.postMessage({
          command: 'screenShare'
        });
      });
      
      // Handle messages from the extension
      window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
          case 'message':
            addMessage(message.sender, message.text);
            break;
          case 'status':
            document.getElementById('status').textContent = message.text;
            break;
          case 'participant':
            updateParticipantStatus(message.id, message.name, message.isConnected);
            break;
        }
      });
      
      function addMessage(sender, text) {
        const messagesDiv = document.getElementById('messages');
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        messageElement.innerHTML = \`<span class="participant">\${sender}:</span> \${text}\`;
        messagesDiv.appendChild(messageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }
      
      function updateParticipantStatus(id, name, isConnected) {
        // You can implement participant list updates here
      }
    </script>
  </body>
  </html>`;
}

async function connectToRoom(serverUrl, token) {
  try {
    if (currentPanel) {
      currentPanel.webview.postMessage({
        type: "status",
        text: "Connecting...",
      });
    }

    room = new Room({
      publishDefaults: {
        screenShareEncoding: {
          maxBitrate: 3_000_000,
          maxFramerate: 30,
        },
      },
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (currentPanel) {
        currentPanel.webview.postMessage({
          type: "participant",
          id: participant.sid,
          name: participant.identity,
          isConnected: true,
        });
      }
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (currentPanel) {
        currentPanel.webview.postMessage({
          type: "participant",
          id: participant.sid,
          name: participant.identity,
          isConnected: false,
        });
      }
    });

    room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
      if (topic === "chat" && participant && currentPanel) {
        const text = new TextDecoder().decode(payload);
        currentPanel.webview.postMessage({
          type: "message",
          sender: participant.identity,
          text: text,
        });
      }
    });

    await room.connect(serverUrl, token);

    if (currentPanel) {
      currentPanel.webview.postMessage({
        type: "status",
        text: `Connected as ${room.localParticipant.identity}`,
      });
    }
  } catch (error) {
    console.error("Failed to connect", error);
    if (currentPanel) {
      currentPanel.webview.postMessage({
        type: "status",
        text: `Connection failed: ${error.message}`,
      });
    }
  }
}

async function toggleScreenShare() {
  if (!room) return;

  const screenSharePub = room.localParticipant
    .getTrackPublications()
    .find((pub) => pub.source === Track.Source.ScreenShare);

  if (screenSharePub && screenSharePub.isSubscribed) {
    await room.localParticipant.unpublishTrack(screenSharePub.trackSid);
  } else {
    try {
      await room.localParticipant.setScreenShareEnabled(true);
    } catch (error) {
      console.error("Screen share failed", error);
      if (currentPanel) {
        currentPanel.webview.postMessage({
          type: "status",
          text: `Screen share failed: ${error.message}`,
        });
      }
    }
  }
}

function deactivate() {
  if (room) {
    room.disconnect();
  }
}

module.exports = {
  activate,
  deactivate,
};
