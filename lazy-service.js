var net = require('net');
var http = require('http');
var spawn = require('child_process').spawn;

var config = require('./config.json');


function getUntilReady(url, callback) {
  http.get(url, function(res) {
    if (res.statusCode == 200)
      callback();
    else {
      console.warn("Got " + res.statusCode + " from [" + url + "]");
      setTimeout(function() {
        getUntilReady(url, callback);
      }, config.testRetryFrequency);
    }
  }).on('error', function(e) {
    console.error("Got error waiting for [" + url + "]: " + e.message);
    setTimeout(function() {
      getUntilReady(url, callback);
    }, config.testRetryFrequency);
  });
}


function runProxy(proxy) {
  proxy.starting = false;
  proxy.started = false;

  proxy.clientHandler = net.createServer(function (clientSocket) {
    var serverSocket = null;
    var bufferedData = [];
    if (!proxy.started && !proxy.starting) {
      console.info("Loading " + proxy.name + " process");
      proxy.starting = true;
      proxy.serverProcess = spawn(proxy.command, proxy.arguments);
      proxy.serverProcess.on("exit", function(code, signal) {
        if (code !== null) {
          console.warn("Lost " + proxy.name + " process with exit code " + code);
        } else {
          console.warn("Lost " + proxy.name + " process with signal " + signal);
        }
        proxy.starting = false;
        proxy.started = false;
        proxy.serverProcess = null;
      });
    }
    getUntilReady(proxy.testUrl, function () {
      serverSocket = new net.Socket();
      serverSocket.connect(parseInt(proxy.serverPort), proxy.serverHost, function () {
        proxy.started = true;
        if (bufferedData.length > 0) {
          var msg = Buffer.concat(bufferedData);
          serverSocket.write(msg);
          console.info("Sent " + msg.length + " bytes of buffered data");
          bufferedData = [];
        }
        serverSocket.on("data", function (data) {
          clientSocket.write(data);
        });
        serverSocket.on('end', function() {
          console.info("Server hung up");
          clientSocket.end();
        });
        serverSocket.on('disconnect', function() {
          console.info("Server lost");
          clientSocket.destroy();
        });
      });
    });
    clientSocket.on('data', function (msg) {
      if (proxy.started)
        serverSocket.write(msg);
      else {
        console.warn("Received " + msg.length + " bytes of client data before server was ready");
        bufferedData.push(msg);
      }
    });
    clientSocket.on('end', function() {
      console.info("Client hung up");
      serverSocket.end();
    });
    clientSocket.on('disconnect', function() {
      console.info("Client lost");
      serverSocket.destroy();
    });
  });

  proxy.clientHandler.listen(proxy.clientPort);
  console.info("Proxy for " + proxy.name + " is listening on " + proxy.clientPort);
}

function runProxies() {
  for (var i in config.proxies) {
    if (config.proxies.hasOwnProperty(i)) {
      var proxy = config.proxies[i];
      runProxy(proxy);
    }
  }
}

runProxies();