var express = require('express'),
  session = require('express-session'),
  mongoStore = require('connect-mongo')(session),
  redisStore = require('connect-redis')(session),
  cookieParser = require('cookie-parser'),
  expressValidator = require('express-validator'),
  bodyParser = require('body-parser'),
  methodOverride = require('method-override'),
  http = require('http'),
  https = require('https'),
  fs = require('fs'),
  ServerEngine = require('./engine'),
  Grid = require('gridfs-stream'),
  errorHandler = require('errorhandler'),
  passport = require('passport');

var morgan = require('morgan');
// var winston = require('winston');
var csurf = require('csurf');
var path = require('path');
var constants = require('constants')
var osprey = require('osprey')
var file = path.join(__dirname, '../../../../..', 'api.raml')

function ExpressEngine(){
  ServerEngine.call(this);
  this.app = null;
  this.db = null;
  this.mean = null;
}
ExpressEngine.prototype = Object.create(ServerEngine,{constructor:{
  value: ExpressEngine,
  configurable: false,
  writable: false,
  enumerable: false
}});
ExpressEngine.prototype.destroy = function(){
  this.mean = null;
  this.db = null;
  this.app = null;
  ServerEngine.prototype.destroy.call(this);
};
ExpressEngine.prototype.name = function(){
  return 'express';
};
ExpressEngine.prototype.initApp = function(){
  var config = this.mean.config.clean;



  // Express/Mongo session storage

  // this.app.use(session({
  //   secret: config.sessionSecret,
  //   store: new mongoStore({
  //     db: config.mongodb.db,
  //     collection: config.sessionCollection
  //   }),
  //   cookie: config.sessionCookie,
  //   name: config.sessionName,
  //   resave: true,
  //   saveUninitialized: true
  // }));
  
  // this.app.use(morgan("dev"));
  
  // this.app.use(session({
  //   secret: config.sessionSecret,
  //   store: new redisStore({
  //     host: config.redis.host,
  //     port: config.redis.port,
  //     pass: config.redis.dbOptions.pass
  //   }),
  //   resave: true,
  //   name: config.sessionName,
  //   saveUninitialized: true
  // }));

  require(process.cwd() + '/config/express')(this.app, this.db);

  // The cookieParser should be above session
  this.app.use(cookieParser());
  // Request body parsing middleware should be above methodOverride

  this.app.use(expressValidator());
  this.app.use(bodyParser.json({limit: '1mb'}));
  this.app.use(bodyParser.urlencoded({
    extended: true,
    limit: '1mb'
  }));
  this.app.use(methodOverride());

  if (config && config.useCsrf) {
    var bypassroutes = ['/apis/auth/login']
    var bypass = function(fn, routes){
      return function(req, res, next) {
        if (routes && routes.length && routes.indexOf(req.url) !== -1) {
          next();
        } else {
          fn(req, res, next);
        }
      }
    };
    this.app.use(bypass(csurf({cookie: true}), bypassroutes));
  }

  this.app.use(passport.initialize());
  this.app.use(passport.session());
  this.mean.register('passport',passport);

  this.app.use("/apidocs", function(req, res, next) { 
    if (!req.user || !req.user.isAdmin()) {
      return res.json(500, {error: "not enough permissions"})
    }
    next()
  }, express.static(config.root + "/apidocs"));

  return this.app;
};
ExpressEngine.prototype.beginBootstrap = function(meanioinstance, database){

  this.mean = meanioinstance;
  this.db = database.connection;
  var config = meanioinstance.config.clean;
  // Express settings
  var app = express();
  app.useStatic = function(a,b){
    if('undefined' === typeof b){
      this.use(express.static(a));
    }else{
      this.use(a,express.static(b));
    }
  };
  this.app = app;

  osprey.loadFile(file)
  .then(function (middleware) {
    app.use(middleware)

    app.use(function (err, req, res, next) {
      // Handle errors.
      res.json(500, {error: err.toString()})
    })

    app.listen(3000)
  }).catch(function(err){
    console.log(err);
    console.log("raml error");
  })

  // Register app dependency;
  meanioinstance.register('app', this.initApp.bind(this));

  var gfs = new Grid(this.db.connection.db, this.db.mongo);

  // var options = {
  //   db: config.mongodb.db, // 'mongodb://127.0.0.1:27017/digbil_dev_',
  //   username: config.mongodb.dbOptions.user,
  //   password: config.mongodb.dbOptions.pass,
  //   collection: 'oc_logs'
  // };
  // winston.add(require('winston-mongodb').MongoDB, options);

  // require(process.cwd() + '/config/express')(this.app, this.db);
  // function themeHandler(req, res) {

  //   res.setHeader('content-type', 'text/css');

  //   gfs.files.findOne({
  //     filename: 'theme.css'
  //   }, function(err, file) {

  //     if (!file) {
  //       fs.createReadStream(config.root + '/bower_components/bootstrap/dist/css/bootstrap.css').pipe(res);
  //     } else {
  //       // streaming to gridfs
  //       var readstream = gfs.createReadStream({
  //         filename: 'theme.css'
  //       });

  //       //error handling, e.g. file does not exist
  //       readstream.on('error', function(err) {
  //         console.log('An error occurred!', err.message);
  //         throw err;
  //       });

  //       readstream.pipe(res);
  //     }
  //   });
  // }

  // // We override this file to allow us to swap themes
  // // We keep the same public path so we can make use of the bootstrap assets
  // app.get('/bower_components/bootstrap/dist/css/bootstrap.css', themeHandler);


  // Listen on http.port (or port as fallback for old configs)

  // Chandler 2015.5.18
  var httpServer = http.createServer(app);
  meanioinstance.register('http', httpServer);
  httpServer.listen(config.http ? config.http.port : config.port, config.hostname);

  if (config.https && config.https.port) {
    var httpsOptions = {
      secureProtocol: 'SSLv23_method',
      secureOptions: constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_SSLv2,
      ca: [fs.readFileSync(config.https.ssl.ca, 'utf8')],
      key: fs.readFileSync(config.https.ssl.key, 'utf8'),
      cert: fs.readFileSync(config.https.ssl.cert, 'utf8')
    };
    var httpsServer = https.createServer(httpsOptions, app);
    meanioinstance.register('https', httpsServer);
    httpsServer.listen(config.https.port);
  }

  meanioinstance.name = config.app.name;
  meanioinstance.app = app;
  meanioinstance.menus = new (meanioinstance.Menus)();
};

function finalRouteHandler(req, res, next) {
  // if (!this.template) return next();
  // this.template(req, res, next);
  res.json(500, {error: "something is wrong.."})
}

function NotFoundHandler(err, req, res, next) {
  // Treat as 404
  if (~err.message.indexOf('not found')) return next();

  // Log it
  console.error(err.stack);

  // Error page
  res.status(500).json({
    error: err.stack
  });
}

function FourOFourHandler(req, res) {
  res.status(404).json({
    url: req.originalUrl,
    error: 'Not found'
  });
}

ExpressEngine.prototype.endBootstrap = function(callback){
  // We are going to catch everything else here
  
  require(process.cwd() + '/config/postexpress')(this.app, this.db);
  
  this.app.route('*').get(finalRouteHandler.bind(this));

  // Assume "not found" in the error msgs is a 404. this is somewhat
  // silly, but valid, you can do whatever you like, set properties,
  // use instanceof etc.
  this.app.use(NotFoundHandler);

  // Assume 404 since no middleware responded
  this.app.use(FourOFourHandler);

  // Error handler - has to be last
  if (process.env.NODE_ENV === 'development') {
    this.app.use(errorHandler());
  }
  callback(this);
};

module.exports = ExpressEngine;
