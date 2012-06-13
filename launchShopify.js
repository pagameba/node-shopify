#!/usr/bin/env node
var requirejs = require('requirejs')
  , cradle = require('cradle');

// hardcode these for this app
var client = 'bluetrail'
  , server = 'shopify';

// local testing
 config = {
    // main database instance
    host: '127.0.0.1',
    port:  5984,
    user: '',
    pass: '',
    dbName: 'mapsherpa'
};

var config = {
  // main database instance
  host: 'couch.mapsherpa.com',
  port:  5984,
  user: 'PaddingtonBear',
  pass: '2W1tiUsZRhUbMG',
  dbName: 'mapsherpa'
};

// build configuration for requirejs when we are running in production mode
var buildConfig = {
  baseUrl: 'public/javascripts',
  name: server,
  out: 'public/javascripts/'+server+'.built.js',
  paths: {
    'hbs':               'libs/require/hbs-1.0.7',
    'jquery':            'libs/jquery/jquery-1.7.1',
     'backbone':          'libs/backbone/backbone',
    'underscore':        'libs/underscore/underscore',
    'handlebars':        'libs/handlebars/handlebars',
    'amd-loader':        'libs/amd-loader',
    'bootstrap':         'libs/bootstrap/bootstrap',
    'client':            'empty:',
    'user':              'empty:'
  }
};

var clientConfig = {
  name: client,
  googleAnalyticsId: '',
  db: {
    host: config.host,
    port: config.port,
    user: config.user,
    pass: config.pass,
    name: client + '-clientdb',
    session: client + '-clientdb-sessions'
  },
  shopify: {
    webhookDomain: 'http://localhost:8003',
    ports: {
      production: 9003,
      development: 8003
    }
  }
  
};

// we need to be able to reach the central database and get the overall configuration document for our client
var mapsherpa = new (cradle.Connection)({host: config.host, port: config.port, auth: {username: config.user, password: config.pass}}).database(config.dbName);
mapsherpa.exists(function(err, exists) {
  if (err) {
    console.log('cradle exists error', err);
    process.exit();
  }
  if (!exists) {
    // create db if it doesn't exist, a minor convenience as we can't run until a configuration is set.
    mapsherpa.create(function() {
      mapsherpa.save(client, clientConfig, function(err, res) {
        if (err) {
          console.log('error saving default client config', err);
        } else {
          console.log('Default client configuration created for ' + client + ', please visit http://' + config.host+':'+config.port+'/_utils/document.html?mapsherpa/'+client +' to configure this client');
        }
        process.exit();
      });
    });
    return;
  }
  mapsherpa.get(client, function(err, doc) {
    if (err) {
      console.log('Error fetching client configuration for ' + client, err);
      mapsherpa.save(client, clientConfig, function(err, res) {
        if (err) {
          console.log('error saving default client config', err);
        } else {
          console.log('Default client configuration created for ' + client + ', please visit http://' + config.host+':'+config.port+'/_utils/document.html?mapsherpa/'+client +' to configure this client');
        }
        process.exit();
      });
      return;
    }
    
    if (!doc[server]) {
      console.log('Client configuration for ' + server + ' is missing, please visit http://' + config.host+':'+config.port+'/_utils/document.html?mapsherpa/'+client +' to configure this client');
      process.exit();
    }

    var mode = process.env.NODE_ENV || 'development';
    
    // validate that there are ports defined
    if (!doc[server].ports || !doc[server].ports[mode]) {
      console.log('Error in client configuration, missing '+server+'.ports configuration for '+mode+' mode, please visit http://' + config.host+':'+config.port+'/_utils/document.html?mapsherpa/'+client +' to configure this client');
      process.exit();
    }

    // make sure they have been changed from the default
    if (doc[server].ports[mode] < 8000) {
      console.log('Client port configuration is invalid for the '+server+' server in ' + mode + ' mode (values must be >= 8000), please visit http://' + config.host+':'+config.port+'/_utils/document.html?mapsherpa/'+client +' to configure this client.');
      console.log('config', doc)
      process.exit();
    }
    
    // make sure name is right
    if (doc.name !== client) {
      console.log('Error in client configuration, name is missing or incorrect.  Please set "name":"'+client+'"');
      process.exit();
    }
    
    // now we can try launching
    var port = doc[server].ports[mode];
    
    console.log('config', doc)
    if (mode == "production") {
      console.log('launching '+server+' server in production mode, building assets');
      requirejs.optimize(buildConfig, function(buildResponse) {
        launch(server, doc, port);
      });
    } else {
      console.log('launching '+server+' server in development mode');
      launch(server, doc, port);
    }
  });
});

function launch(server, config, port) {
  console.log('require:'+server+'.js');
  require('./'+server+'.js')(config).on('init', function(app) {
    app.listen(port);
    console.log(server + ' server started on port ' + port);
  });
}
