const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

io.on('connection', (socket) => {
  console.log("客户端已连接", socket.id);

  socket.on('chat', (msg)=>{
    io.emit('chat', msg);
  })

  socket.on('disconnect', ()=>{
    console.log("客户端断开",socket.id);
  })
})

app.get('/', (req,res)=>{
  res.send("服务运行正常");
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>{
  console.log(`服务启动端口${PORT}`);
})
