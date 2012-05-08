require.config({
  paths: {
    'jquery': 'jquery-1.7.1.min',
    'order':'order-1.0.5'
  }
});

define([
  'jquery'
], function($){
  // main code line
  alert('ready to go');
  return {};
});