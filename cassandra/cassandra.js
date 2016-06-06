module.exports = function (RED) {
    "use strict";
    var cassandra = require('cassandra-driver');

    function CassandraNode(n) {
        RED.nodes.createNode(this, n);
        this.hosts = n.hosts;
        this.port = n.port;

        this.connected = false;
        this.connecting = false;

        this.keyspace = n.keyspace;
        var node = this;

        function doConnect() {
            node.connecting = true;

            var authProvider = null;
            if (node.credentials.user) {
                authProvider = new cassandra.auth.PlainTextAuthProvider(
                    node.credentials.user,
                    node.credentials.password
                );
            }

            // TODO: Support other port, default is 9042
            node.connection = new cassandra.Client({
                contactPoints: node.hosts.replace(/ /g, "").split(","),
                keyspace: node.keyspace,
                authProvider: authProvider
            });

            node.connection.connect(function (err) {
                node.connecting = false;
                if (err) {
                    node.error(err);
                    node.status({fill:"red",shape:"ring",text:"disconnected"});
                    node.tick = setTimeout(doConnect, 30000);
                } else {
                    node.connected = true;
                    node.status({fill:"green",shape:"dot",text:"connected"});
                }
            });

        }

        this.connect = function () {
            if (!this.connected && !this.connecting) {
                doConnect();
            }
        }

        this.on('close', function (done) {
            if (this.tick) { clearTimeout(this.tick); }
            if (this.connection) {
                node.connection.shutdown(function (err) {
                    if (err) { node.error(err); }
                    done();
                });
            } else {
                done();
            }
        });
    }
    RED.nodes.registerType("CassandraDatabase",CassandraNode, {
        credentials: {
            user: {type: "text"},
            password: {type: "password"}
        }
    });


    function CassandraNodeIn(n) {
        RED.nodes.createNode(this,n);
        this.mydb = n.mydb;
        this.mydbConfig = RED.nodes.getNode(this.mydb);

        if (this.mydbConfig) {
            this.mydbConfig.connect();
            var node = this;
            this.on("input", function(msg) {
                var batchMode = Array.isArray(msg.topic);
                if (!batchMode && typeof msg.topic !== 'string') {
                    node.error("msg.topic : the query is not defined as a string or as an array of queries");
                    return;
                }
                var resCallback = function(err, result) {
                    if (err) {
                        node.error(err,msg);
                    } else {
                        msg.payload = result.rows;
                        node.send(msg);
                    }
                };

                if (batchMode) {
                    node.log("Batching " + msg.topic.length + " CQL queries");
                    node.mydbConfig.connection.batch(msg.topic, {prepare: true}, resCallback);
                } else {
                    node.log("Executing CQL query: ", msg.topic);
                    var params = msg.payload || [];
                    node.mydbConfig.connection.execute(msg.topic, params, {prepare: true}, resCallback);
                }
                node.status({fill:"green",shape:"dot",text:"executing..."});
            });
        }
        else {
            this.error("Cassandra database not configured");
        }
    }
    RED.nodes.registerType("cassandra", CassandraNodeIn);
}
