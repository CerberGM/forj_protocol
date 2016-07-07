/*
 === ForJ v0.1 ===
 JSON over TCP/IP protocol
 Author: Nikulin Aleksey (c) 2016
 e-mail: nikulin.alex.v@gmail.com

 config
 host - Хост сервера
 port - Порт сервера
 allow_from - Список разрешенных IP адресов для подключения к серверу
 reconnect - Переподключиться при разрыве соединения
 welcome_message - Сообщение для нового соединения
 */

var net = require("net");
var EventEmiter = require("events");
var EOL = require("os").EOL;
var message_end_code = 0;
var message_types = {
	WELCOME: 0,
	// PREFIX: 1,
	CALL: 2,
	RESULT: 3,
	CALL_ERROR: 4,
	SUBSCRIBE: 5,
	UNSUBSCRIBE: 6,
	PUBLISH: 7,
	EVENT: 8
};

// [type, id_call, event_name, params]


// Сервер
function Server() {
	this.id_call = 0;
	this.server = false;
	this.callbacks = {};
	this.clients = {};
	this.buffer = "";
	this.request = [];
	this.subscribed = {};
}

exports.Server = Server;
Server.prototype.__proto__ = EventEmiter.prototype;


// Обработчик события
function serverEventHandler(socket, type, id_call, event_name, params) {
	var _this = this;
	if (type === message_types.CALL) {
		var args = [event_name, socket].concat(params);
		args.push(function(err, result) {
			_this.send(socket, [message_types.RESULT, id_call, event_name, [err, result]]);
		});
		_this.emit.apply(_this, args);
	} else if (type === message_types.CALL_ERROR) {
		var args = ["call_error", socket].concat(params);
		_this.emit.apply(_this, args);
		if (_this.callbacks[id_call]) {
			_this.callbacks[id_call].apply(_this, params);
		}
	} else if (type === message_types.RESULT) {
		if (_this.callbacks[id_call]) {
			_this.callbacks[id_call].apply(_this, params);
		}

	} else if (type === message_types.SUBSCRIBE) {
		_this.subscribe(socket, event_name);
	} else if (type === message_types.UNSUBSCRIBE) {
		_this.unsubscribe(socket, event_name);
	} else if (type === message_types.PUBLISH) {
		_this.event(event_name, params);
	} else {
		_this.call_error("Неверный тип запроса");
	}
}

// Создать сервер
Server.prototype.createServer = function(config, callback) {
	var _this = this;

	if (!_this.server) {
		_this.config = config;
		_this.server = net.createServer();
		_this.server.listen(config.port, config.host);

		_this.server.on("connection", function(socket) {
			socket.sid = new Date().getTime();
			var allow_to_connect = true;
			if (_this.config.allow_from && _this.config.allow_from.length > 0) {
				allow_to_connect = false;
				for (var i in _this.config.allow_from) {
					if (_this.config.allow_from[i] === socket.remoteAddress) {
						allow_to_connect = true;
						break;
					}
				}
			}

			if (allow_to_connect) {
				_this.send(socket, [message_types.WELCOME, 0, "welcome", [config.welcome_message]]);
				socket.on("close", function() {
					_this.closeSocket(socket);
				});
				_this.clients[socket.sid] = socket;

				// Получаем данные и собирам в буффер
				_this.buffer = "";
				socket.on("data", function(chunk) {
					chunk = chunk.toString();
					for (var i in chunk) {
						if (chunk[i].charCodeAt(0) === message_end_code) {
							if (_this.buffer.length > 0) {
								var request;
								try {
									request = JSON.parse(_this.buffer);
								} catch (err) {
									_this.call_error(socket, err.message);
									err.message += EOL + " IP: " + socket.remoteAddress;
									err.message += EOL + " Буффер: " + _this.buffer;
									_this.closeSocket(socket);
									_this.emit("error", err);
								}

								if (request) {
									_this.request = request;
									if (request.length === 4) {
										serverEventHandler.call(_this, socket, request[0], request[1], request[2], request[3]);
									} else {
										var err = new Error("Неверный запрос");
										_this.call_error(socket, err.message);
										err.message += EOL + " IP: " + socket.remoteAddress;
										err.message += EOL + " Запрос: " + JSON.stringify(request);
										_this.closeSocket(socket);
										_this.emit("error", err);
									}
								}

								_this.buffer = "";
							}
						} else {
							_this.buffer += chunk[i];
						}
					}
				});
				
				_this.emit("connection", socket);
			} else {
				var err = new Error("Доступ закрыт");
				_this.call_error(socket, err.message);
				err.message += EOL + " IP: " + socket.remoteAddress;
				_this.closeSocket(socket);
				_this.emit("error", err);
			}
		});

		_this.server.on("listening", function() {
			callback(null, true);
		});

		_this.server.on("error", function(err) {
			callback(err);
		});

		_this.server.on("close", function() {
			_this.emit("close");
		});
	} else {
		callback("Сервер уже создан");
	}
};

// Вызов события клиента
Server.prototype.call = function(socket, event_name, params, callback) {
	var _this = this;

	if (callback === undefined && typeof params === "function") {
		callback = params;
		params = [];
	}

	if (!(params instanceof Array)) {
		params = [params];
	}

	_this.id_call++;
	if (callback !== undefined && typeof callback === "function") {
		_this.callbacks[_this.id_call] = callback;
	}
	_this.send(socket, [message_types.CALL, _this.id_call, event_name, params]);
};

// Вызов ошибки клиента
Server.prototype.call_error = function(socket, params, callback) {
	var _this = this;

	if (callback === undefined && typeof params === "function") {
		callback = params;
		params = [];
	}

	if (!(params instanceof Array)) {
		params = [params];
	}

	// _this.id_call++;
	if (callback !== undefined && typeof callback === "function") {
		_this.callbacks[_this.id_call] = callback;
	}
	_this.send(socket, [message_types.CALL_ERROR, _this.id_call, null, params]);
};

// Отпрака сообщения
Server.prototype.send = function(socket, message) {
	if (socket) {
		socket.write(JSON.stringify(message) + String.fromCharCode(message_end_code));
	}
};

// Отановить сервер
Server.prototype.stopServer = function(callback) {
	var _this = this;
	if (_this.server) {
		for (var sid in _this.clients) {
			_this.closeSocket(this.clients[sid]);
		}

		_this.server.close(function() {
			if (typeof callback === "function") {
				callback(null, true);
			}
		});
		_this.server = false;
	}
};

// Подписка на события в комнате
Server.prototype.subscribe = function(socket, room, callback) {
	if (!this.subscribed[room]) this.subscribed[room] = {};
	this.subscribed[room][socket.sid] = socket;

	if (typeof callback === "function") {
		callback(null, true);
	}
};

// Отписка от событий в комнате
Server.prototype.unsubscribe = function(socket, room, callback) {
	if (this.subscribed[room]) {
		delete this.subscribed[room][socket.sid];
	}

	if (typeof callback === "function") {
		callback(null, true);
	}
};

// Сообщение подписчикам в комнату
Server.prototype.event = function(room, params, callback) {
	if (this.subscribed[room]) {
		if (!(params instanceof Array)) {
			params = [params];
		}

		for (var sid in this.subscribed[room]) {
			this.send(this.subscribed[room][sid], [message_types.EVENT, 0, room, params]);
		}

		if (typeof callback === "function") {
			callback(null, true);
		}
	} else {
		if (typeof callback === "function") {
			callback(null, false);
		}
	}
};

// Закрыть соединение
Server.prototype.closeSocket = function(socket) {
	for (var room in this.subscribed) {
		delete this.subscribed[room][socket.sid];
	}

	delete this.clients[socket.sid];
	try {
		socket.connected = false;
		socket.end();
		socket.destroy();
	} catch (err) {
		/***/
	}
};


// ----------------------------------------------------------------------------
// Клиент

function Client() {
	this.id_call = 0;
	this.socket = false;
	this.callbacks = {};
	this.buffer = "";
	this.request = [];
}

exports.Client = Client;
Client.prototype.__proto__ = EventEmiter.prototype;


// Обработчик события
function clientEventHandler(type, id_call, event_name, params) {
	var _this = this;

	if (type === message_types.WELCOME) {
		_this.emit.call(_this, "welcome", params[0]);
	} else if (type === message_types.CALL) {
		var args = [event_name].concat(params);
		args.push(function(err, result) {
			_this.send([message_types.RESULT, id_call, event_name, [err, result]]);
		});
		_this.emit.apply(_this, args);
	} else if (type === message_types.CALL_ERROR) {
		var args = ["call_error"].concat(params);
		_this.emit.apply(_this, args);
		if (_this.callbacks[id_call]) {
			_this.callbacks[id_call].apply(_this, params);
		}
	} else if (type === message_types.RESULT) {
		if (_this.callbacks[id_call]) {
			_this.callbacks[id_call].apply(_this, params);
		}
	} else if (type === message_types.EVENT) {
		_this.emit.apply(_this, ["event"].concat(params));
	} else {
		_this.call_error("Неверный тип запроса");
	}
}

// Соедиенение
Client.prototype.connect = function(config, callback) {
	var _this = this;

	if (!_this.socket) {
		_this.config = config;
		_this.socket = net.connect(config);
		_this.socket.on("connect", function() {
			callback(null, _this.socket);
		});

		// Получаем данные и собирам в буффер
		_this.buffer = "";
		_this.socket.on("data", function(chunk) {
			chunk = chunk.toString();
			for (var i in chunk) {
				if (chunk[i].charCodeAt(0) === message_end_code) {
					if (_this.buffer.length > 0) {
						var request;
						try {
							request = JSON.parse(_this.buffer);
						} catch (err) {
							_this.call_error(err.message);
							err.message += EOL + " Буффер: " + _this.buffer;
							_this.close();
							_this.emit("error", err);
						}

						_this.buffer = "";
						if (request) {
							_this.request = request;
							if (request.length === 4) {
								clientEventHandler.call(_this, request[0], request[1], request[2], request[3]);
							} else {
								var err = new Error("Неверный запрос");
								_this.call_error(err.message);
								err.message += EOL + " Запрос: " + JSON.stringify(request);
								_this.close();
								_this.emit("error", err);
							}
						}
					}
				} else {
					_this.buffer += chunk[i];
				}
			}
		});

		_this.socket.on("close", function() {
			_this.emit("close");
			_this.socket.destroy();
			_this.socket = false;

			if (_this.config.reconnect) {
				setTimeout(function() {
					_this.reconnect(function(err, socket) {
						if (err) {
							_this.emit("error", err);
						} else {
							_this.emit("reconnect", socket);
						}
					});
				}, 1000);
			}
		});

		_this.socket.on("error", function(err) {
			callback(err);
		});
	} else {
		callback("Соединение уже установлено");
	}
};

// Переподключение к серверу
Client.prototype.reconnect = function(callback) {
	var _this = this;
	if (_this.config) {
		if (_this.socket) {
			_this.close();
		}

		_this.connect(_this.config, callback);
	} else {
		callback("Конфиг не определен");
	}
};

// Вызов события сервера
Client.prototype.call = function(event_name, params, callback) {
	var _this = this;

	if (callback === undefined && typeof params === "function") {
		callback = params;
		params = [];
	}

	if (!(params instanceof Array)) {
		params = [params];
	}

	_this.id_call++;
	if (callback !== undefined && typeof callback === "function") {
		_this.callbacks[_this.id_call] = callback;
	}
	_this.send([message_types.CALL, _this.id_call, event_name, params]);
};

// Вызов ошибки сервера
Client.prototype.call_error = function(params, callback) {
	var _this = this;

	if (callback === undefined && typeof params === "function") {
		callback = params;
		params = [];
	}

	if (!(params instanceof Array)) {
		params = [params];
	}

	//_this.id_call++;
	if (callback !== undefined && typeof callback === "function") {
		_this.callbacks[_this.id_call] = callback;
	}
	_this.send([message_types.CALL_ERROR, _this.id_call, null, params]);
};

// Отпрака сообщения
Client.prototype.send = function(message) {
	if (this.socket) {
		this.socket.write(JSON.stringify(message) + String.fromCharCode(message_end_code));
	}
};

// Подписка на события в комнате
Client.prototype.subscribe = function(room, callback) {
	this.send([message_types.SUBSCRIBE, 0, room, []]);

	if (typeof callback === "function") {
		callback(null, true);
	}
};

// Отписка от событий в комнате
Client.prototype.unsubscribe = function(room, callback) {
	this.send([message_types.UNSUBSCRIBE, 0, room, []]);

	if (typeof callback === "function") {
		callback(null, true);
	}
};

// Сообщение подписчикам в комнату
Client.prototype.publish = function(room, params, callback) {
	if (!(params instanceof Array)) {
		params = [params];
	}
	this.send([message_types.PUBLISH, 0, room, params]);

	if (typeof callback === "function") {
		callback(null, true);
	}
};

// Закрыть соединение
Client.prototype.close = function() {
	if (this.socket) {
		this.socket.end();
	}
};