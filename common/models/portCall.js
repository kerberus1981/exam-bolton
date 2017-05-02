'use strict';

module.exports = function(PortCall) {

  PortCall.getRoutes = function(etd, eta, cb) {
    // For more information on how to query data in loopback please see
    // https://docs.strongloop.com/display/public/LB/Querying+data
    const query = {
      where: {
        and: [
          { // port call etd >= etd param, or can be null
            or: [{ etd: { gte: etd } }, { etd: null }]
          },
          { // port call eta <= eta param, or can be null
            or: [{ eta: { lte: eta } }, { eta: null }]
          }
        ]
      }
    };

    PortCall.find(query)
      .then(calls => {
        // TODO: convert port calls to voyages/routes
        console.log(calls);

        return cb(null, calls);
      })
      .catch(err => {
        console.log(err);

        return cb(err);
      });
  };

  PortCall.remoteMethod('getRoutes', {
    accepts: [
      { arg: 'etd', 'type': 'date' },
      { arg: 'eta', 'type': 'date' }
    ],
    returns: [
      { arg: 'routes', type: 'array', root: true }
    ]
  });

  /**
  With the given amount of data (port calls), it seems to work fine and found no problem with performance.
  It is also possible to have a background/cron process that generates a json file of all the voyages from the list of port calls.
  "pre calculated/generated", I am not sure if we really need to compute at real time, regenerate only when portsCalls.json is updated.
  It could save some running time delivering result to the end user.
  */
  PortCall.getVoyages = function(etd, eta, transhipment, cb) {
    
    const query = {
      where: {
        and: [
          { // port call etd >= etd param, or can be null
            or: [{ etd: { gte: etd } }, { etd: null }]
          },
          { // port call eta <= eta param, or can be null
            or: [{ eta: { lte: eta } }, { eta: null }]
          }
        ]
      }
    };

    PortCall.find(query)
      .then(calls => {
        /**
        We assume that for the same ship/routeID, the ship is intended to drop and pickup some cargo 
        before moving to the next destination. It's no longer necessary to check dates of departure
        */
        function getVoyages(routes, voyages){
          return new Promise (function(resolve, reject) {
            function recurse(routes,voyages){  
                  var counter;
                  for (counter = 1; counter < routes.length; counter++) { 
                    if(routes[0].routeId == routes[counter].routeId){
                      var voyage = {
                        'fromRouteId': routes[0].routeId,
                        'fromPort': routes[0].port,
                        'fromEtd': routes[0].etd,
                        'fromEta': routes[0].eta,
                        'toRouteId': routes[counter].routeId,
                        'toPort': routes[counter].port,
                        'toEtd': routes[counter].etd,
                        'toEta': routes[counter].eta,
                        'vessel':routes[0].vessel,
                        'details': '',
                      };
                      voyages.push(voyage); 
                    }
                  }
                  routes.splice(0,1);
                  if(routes.length > 1){
                    recurse(routes, voyages);
                  } else{
                    resolve(voyages);
                  }
              }
            recurse(routes,voyages);
          });
        }
        /**
        I dont think this is the optimal/proper solution, I was thinking about something like spanning tree.
        This is all I could implement as of now. I would say this is not an efficient solution and it suuports only single ship transfer. 
        Time ovelap are not calulated, just inclusive
        */   
        function getTranshipments(routes, transhipments){
           
           return new Promise (function(resolve, reject) {
              function recurse(routes, transhipments){
                var counter1;
                var currentRoute = routes[0];
                var details = '';
                var ports = [];
                //get all voyages for this routeId to serve as bridge route. its like current->bridge->destination
                for(counter1 = 1 ; counter1 < routes.length; counter1++){
                  if(currentRoute.routeId == routes[counter1].routeId){
                    ports.push(routes[counter1].port);                   
                    var counter2;
                    for(counter2 = counter1+1; counter2 < routes.length; counter2++){
                      //see if these are not of the same route
                      if( (currentRoute.routeId != routes[counter2].routeId)
                        //see if they are on the same port
                        && (routes[counter1].port == routes[counter2].port) 
                        //prevent the same ship (loop)/different routeId the same ship    
                        && (currentRoute.vessel != routes[counter2].vessel) 
                        //see if the date ranges ovelaps, could be calculated like at least 1 day overlap
                        && (routes[counter1].eta <= routes[counter2].etd && routes[counter2].eta <= routes[counter1].etd) ){
                        //the next vayages of calls[counter+1] are voyages of calls[counter] by transhipping in this current por                         
                        var counter3;
                        details = 'Routes - '+ currentRoute.port + ' -> '+ ports.join('->') +' (transhipment) ' ;
                          for(counter3 = counter2+1; counter3 < routes.length; counter3++){
                            if((routes[counter2].routeId == routes[counter3].routeId) 
                              && (routes[counter2].id != routes[counter3].id) 
                              //prevent going back to the same port
                              && (currentRoute.port != routes[counter3].port) 
                              //prevet destination loop
                              && (ports.indexOf(routes[counter3].port) < 0) 
                              ){
                              details = details + ' -> ' + routes[counter3].port;
                              var transhipment = {
                                'fromRouteId': currentRoute.routeId,
                                'fromPort': currentRoute.port,
                                'fromEtd': currentRoute.etd,
                                'fromEta': currentRoute.eta,
                                'toRouteId': routes[counter3].routeId,
                                'toPort': routes[counter3].port,
                                'toEtd': routes[counter3].etd,
                                'toEta': routes[counter3].eta,
                                'vessel':currentRoute.vessel + ' - ' + routes[counter3].vessel,
                                'details': details
                              };
                            transhipments.push(transhipment);
                          }    
                        }
                      }
                    }
                  }
                }  
                routes.splice(0,1);
                if(routes.length > 1){
                  recurse(routes, transhipments);
                } else{
                  resolve(transhipments);
                }
              }
              recurse(routes, transhipments);
           });
        }

         /*
            todo: we dont really need to wait for getVoyages to finish before getTranshipments
                  but we need both to finish before returning the result.   
         */ 
        var voyages =[]; 
        getVoyages(calls.concat([]), voyages).then(function final(result){
          if(true == transhipment){
            var transhipments = [];
            getTranshipments(calls.concat([]), transhipments).then(function final(result2){
            voyages =  result.concat(result2);
            return cb(null, voyages);
            });
          }else{
            return cb(null, result);
           } 
        });        
      })
      .catch(err => {
        console.log(err);
        return cb(err);
      });
  };

  PortCall.remoteMethod('getVoyages', {
    accepts: [
      { arg: 'etd', 'type': 'date' },
      { arg: 'eta', 'type': 'date' },
      { arg: 'transhipment', 'type': 'boolean' },
    ],
    returns: [
      { arg: 'voyages', type: 'array', root: true }
    ]
  });
};