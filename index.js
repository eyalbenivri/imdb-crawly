var fs = require('fs'),Î
    crawler = require('./crawler');

var env = process.env.NODE_ENV = process.env.NODE_ENV || 'development';
var config = require('./config')[env];

var checkMovies = function() {
    if(moviesToParse.length > 0) {
        var movieId = moviesToParse.shift();
        var movieUrl = "http://www.imdb.com/title/"+movieId+"/";
        crawler.readMovie(movieUrl, movieId).then(function(movie) {
            fs.appendFile('files/movies.data', JSON.stringify(movie) + "\n", function() { m++; console.log("m", m); });
            for (var j = 0; j < movie.cast.length; j++) {
                var castMember = movie.cast[j];
                actorsToParse.push(castMember.imdbid);
            }
            checkActors();
        }).catch(function(err) {
            console.log('fail', err);
        });
    }
};
var checkActors = function() {
    if(actorsToParse.length > 0) {
        var actorId = actorsToParse.shift();
        var actorUrl = "http://www.imdb.com/name/"+actorId+"/";
        crawler.readActor(actorUrl, actorId).then(function(actor) {
            fs.appendFile('files/actors.data', JSON.stringify(actor) + "\n", function() { a++; console.log("a", a); });
            for (var j = 0; j < actor.movies.length; j++) {
                var movie = actor.movies[j];
                moviesToParse.push(movie.imdbid);
            }
            checkMovies();
        }).catch(function(err) {
            console.log('actor fail', err);
        });
    }
};

var moviesToParse = ['tt0111161'];
var actorsToParse = [];
var m = 0;
var a = 0;
var i = 0;
while(i++ < 100) {
    checkMovies();

    checkActors();
}

