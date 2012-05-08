var express = require('express')
  , app = express.createServer();
  

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'hbs');
  app.use(express.logger({
    format: ':method :url'
  }));
  app.use(express.methodOverride());
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.session({
    secret: 'secret'
  }));
  app.use(express.compiler({ src: __dirname + '/public', enable: ['less'] }));
  app.use(express.static(__dirname + '/public'));
  app.use(app.router);
});

app.get('/', function(req, res, next) {
  res.render('index.hbs', {});
});

app.error(function(err, req, res) {
  console.log(err);
});

app.listen(8000);