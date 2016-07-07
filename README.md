# Welcome to the ForJ protocol wiki!

# Example

## Client

    var config = {
        enabled: true,
        host: "127.0.0.1",
        port: 10001,
        reconnect: true,
        allowed_ips: [
            "127.0.0.1"
        ]
    };

    var client = new protocol.Client();
    client.connect(config, function(err) {
        client.on("welcome", function(msg) {
            console.log(msg);
        });
    
        client.call("ping", function(err, result) {
            console.log("Calling ping", err, result);
        });
    
        client.on("pong", function(callback) {
            console.log("We got pong");
            callback(null, true);
        });
    });

## Server

    var server = new protocol.Server();
    server.createServer(config, function(err) {
        if (err) {
            throw new Error(err);
        } else {
            console.log("Server created");
            server.on("ping", function(socket, callback) {
                func.log("Called ping");
                server.call(socket, "pong", function(err, result) {
                    func.log("We go pong!");
                });
                callback(null, true);
            });
        }
    });
