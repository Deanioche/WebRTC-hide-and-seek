import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";

const __dirname = path.resolve();
const app = express();
const rooms = {};
app.set('view engine', 'ejs');
app.use(express.static("public"));

app.get("/", async (req, res, next) => {
    const roomInfo = Object.values(rooms).map(room => ({
        roomId: room.roomId,
        user_cnt: room.user_cnt,
        host: room.host,
        private: room.private,
    })).filter(x => x.private === false);

    res.render("index", { room_list: roomInfo });
});

app.get("/new", async (req, res, next) => {
    const roomId = Math.random().toString(36).slice(2, 16);
    rooms[roomId] = {
        createdAt: Date.now(),
        private: false,
        lastPing: Date.now(),
    };
    res.redirect(`/join/${roomId}`);
});

app.get("/private", (req, res, next) => {
    const roomId = Math.random().toString(36).slice(2, 16);
    rooms[roomId] = {
        createdAt: Date.now(),
        private: true,
        lastPing: Date.now(),
    };
    res.redirect(`/join/${roomId}`);
});

app.get("/join/:roomId", async (req, res, next) => {
    const roomId = req.params.roomId;
    if (rooms[roomId] == null) {
        res.sendStatus(404);
        return;
    }
    let isHost = false;
    if (rooms[roomId].checkout == null) {
        isHost = true;
        rooms[roomId].checkout = true;
    }
    res.render("room", { roomId, isHost });
});

const server = http.createServer(app);
const wss = new Server(server);
server.listen(3000);

wss.on("connection", socket => {
    socket.on("createRoom", (payload) => {
        const { roomId } = payload;
        if (rooms[roomId] == null || rooms[roomId].checkout == null)
            return;
        rooms[roomId].host = socket.id;
        rooms[roomId].roomId = roomId;
        socket.join(roomId);
        console.log(socket.id, "createRoom", roomId, rooms);
        socket.emit("createRoom", roomId);
    });
    socket.on("offer", async (payload) => {
        const { roomId, connId, offer } = payload;
        console.log(socket.id, "offer", connId, roomId);
        if (rooms[roomId] == null || rooms[roomId].checkout == null || rooms[roomId].host == null)
            return;
        const hostSocket = wss.sockets.sockets.get(rooms[roomId].host);
        if (hostSocket == null)
            return;
        await hostSocket.join(connId);
        await socket.join(connId);
        if (rooms[roomId] == null)
            return;
        socket.to(connId).emit("offer", { connId, offer });
        rooms[roomId].user_cnt = (rooms[roomId].user_cnt || 0) + 1;
    });
    socket.on("answer", (payload) => {
        const { connId, answer } = payload;
        console.log(socket.id, "answer", connId)
        socket.to(connId).emit("answer", { connId, answer });
    });
    socket.on("ice", (payload) => {
        const { candidate, connId } = payload;
        console.log(socket.id, "ice", connId);
        socket.to(connId).emit("ice", { candidate, connId });
    });
    socket.on("freezeRoom", (payload) => {
        const { roomId } = payload;
        console.log("freezeRoom", roomId);
        if (rooms[roomId])
            delete rooms[roomId];
    });
    socket.on("pingToSocket", (payload) => {
        const { roomId } = payload;
        if (rooms[roomId] == null)
        {
            console.log("disconnect", socket.id);
            socket.disconnect();
            return;
        }
        if (rooms[roomId] != null && rooms[roomId].lastPing != null)
            rooms[roomId].lastPing = Date.now();
    });
});

app.get("/edit", (req, res, next) => {
    res.render("edit");
});

setInterval(() => {
    Object.values(rooms).forEach(room => {
        if (room.lastPing && Date.now() - room.lastPing > 5000 ) {
            console.log("room", room.roomId, "is closed");
            delete rooms[room.roomId];
        }
    });
}, 3000);
