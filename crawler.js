var http = require("http"),
    htmlparser = require("htmlparser"),
    q = require('q');

var imdbHelper = {
    getActorUname: function(actor) {
        var urlParts = actor.url.split("/");
        return "talent-" + actor.name.toLowerCase().replace(/\s|,|\/|:|-/g, "_").replace(/[^A-Za-z_]/g, "") + "-" + urlParts[urlParts.length - 2];
    },
    getUname: function(movie) {
        var urlParts = movie.url.split("/");
        return movie.year + "-" + movie.title.toLowerCase().replace(/\s|,|\/|:|-/g, "_").replace(/[^A-Za-z0-9_]/g, "") + "-" + urlParts[urlParts.length - 2];
    },
    parseCurrency: function(div) {
        var grossSplit = div.children[1].data.trim().replace(/,/g, "");
        var symbol = grossSplit.replace(/[0-9]*/g, '');
        var number = parseInt(grossSplit.replace(/[^0-9]*/g, ''));
        var symbolName = "";
        switch(symbol) {
            case "$":
                symbolName = "USD";
                break;

            case "&pound;":
                symbolName = "GBP";
                break;

            case "&euro;":
                symbolName = "EUR";
                break;

            default:
                symbolName = symbol;
        }
        return {
            currency: symbolName,
            amount: number
        };
    }
};

var imdb = function() {
    var self = this;

    var getDom = function(url) {
        var dfr = q.defer();

        var client = http.request(url, function(clientRes) {
            var html = '';
            clientRes.on('error', function(error) {
                dfr.reject(error);
            });
            clientRes.on('data', function (chunk) {
                html += chunk;
            });
            clientRes.on('end', function() {
                var handler = new htmlparser.DefaultHandler(function (error, dom) {
                    if (error) {
                        dfr.reject(error);
                    } else {
                        dfr.resolve(dom);
                    }
                }, { ignoreWhitespace: true, verbose: false });
                var parser = new htmlparser.Parser(handler);
                parser.parseComplete(html);
            });
        });
        client.end();

        return dfr.promise;
    };

    self.loadList = function() {
        var dfr = q.defer();

        var url = "http://www.imdb.com/search/title?groups=top_1000&sort=user_rating&view=simple";
        var movies = [];
        var promises = [];
        for (var pageNum = 0; pageNum < 10; pageNum++) {
            var pageUrl = url + "&start=" + (100 * pageNum + 1);
            promises.push(getDom(pageUrl));
        }
        q.all(promises).then(function(results) {
            for(var i = 0; i < results.length; ++i) {
                var moviesInPage = readListPage(results[i]);
                for(var j = 0; j < moviesInPage.length; ++j) {
                    movies.push(moviesInPage[j]);
                }
            }
            dfr.resolve(movies);
        });
        return dfr.promise;
    };

    var readListPage = function(dom) {
        var movies = [];
        var tables = htmlparser.DomUtils.getElementsByTagName("table", dom);
        var results;
        for (var i = 0; i < tables.length; i++) {
            if(tables[i].attribs && tables[i].attribs.class == "results") {
                results = tables[i];
                break;
            }
        }

        var rows = htmlparser.DomUtils.getElementsByTagName("tr", results);
        for (var i = 0; i < rows.length; i++) {
            if(rows[i].attribs && rows[i].attribs.class) {
                var link = rows[i].children[1].children[0];
                var movie = {
                    year: parseInt(rows[i].children[1].children[1].children[0].data.trim().replace(/\(|\)/g, "")),
                    title: link.children[0].data.trim(),
                    url: "http://www.imdb.com" + link.attribs.href
                };
                movie.uname = imdbHelper.getUname(movie);
            }
            if(movie) movies.push(movie.url);
        }

        return movies;
    };

    self.readMovie = function(url, imdbid) {
        var dfr = q.defer();

        getDom(url).then(function(dom) {
            var movie = { url: url, imdbid : imdbid };
            try {
                var metaDataBox = htmlparser.DomUtils.getElementById("title-overview-widget-layout", dom);
                var titleDetailsBox = htmlparser.DomUtils.getElementById("titleDetails", dom);

                var headers = htmlparser.DomUtils.getElementsByTagName("h1", metaDataBox);
                for (var i = 0; i < headers.length; i++) {
                    if(headers[i].attribs && headers[i].attribs.class == "header") {
                        movie.title = headers[i].children[0].children[0].data;
                        var yearObjectCounter = 0;
                        var yearObject = htmlparser.DomUtils.getElementsByTagName("a", headers[i]);
                        if(yearObject.length == 0) {
                            yearObject = htmlparser.DomUtils.getElementsByTagName("span", headers[i]);
                            yearObjectCounter = 1;
                        }

                        movie.year = parseInt(yearObject[yearObjectCounter].children[0].data.trim().replace(''));
                    }
                }

                var divs = htmlparser.DomUtils.getElementsByTagName("div", metaDataBox);
                for (var i = 0; i < divs.length; i++) {
                    if(divs[i].attribs) {
                        if(divs[i].attribs.class == "titlePageSprite star-box-giga-star") {
                            movie.rating = parseFloat(divs[i].children[0].data);
                        }
                        if(divs[i].attribs.class == "infobar") {
                            var timeElement = htmlparser.DomUtils.getElementsByTagName("time", divs[i]);
                            if(timeElement && timeElement.length > 0 && timeElement[0].children.length > 0) {
                                movie.minutes = parseInt(timeElement[0].children[0].data.trim().split(' ')[0]);
                                var genres = htmlparser.DomUtils.getElementsByTagName("span", divs[i]);
                                movie.genres = [];
                                for(var t = 0; t < genres.length; t++) {
                                    if(genres[t].attribs && genres[t].attribs.itemprop == "genre") {
                                        movie.genres.push(genres[t].children[0].data.trim());
                                    }
                                }
                            }
                        }
                    }
                }

                var images = htmlparser.DomUtils.getElementsByTagName("img", metaDataBox);
                for (var i = 0; i < images.length; i++) {
                    if(images[i].attribs && images[i].attribs.itemprop == "image") {
                        movie.image = {
                            height: parseInt(images[i].attribs.height),
                            width: parseInt(images[i].attribs.width),
                            src: images[i].attribs.src
                        };
                    }
                }

                var paragraphs = htmlparser.DomUtils.getElementsByTagName("p", metaDataBox);
                for (var i = 0; i < paragraphs.length; i++) {
                    if(paragraphs[i].attribs && paragraphs[i].attribs.itemprop == "description" && paragraphs[i].children.length > 0 && paragraphs[i].children[0].data) {
                        movie.desc = paragraphs[i].children[0].data.trim();
                    }
                }

                var detailsDivs = htmlparser.DomUtils.getElementsByTagName("div", titleDetailsBox);
                for (var i = 0; i < detailsDivs.length; i++) {
                    if(detailsDivs[i].attribs && detailsDivs[i].attribs.class == "txt-block") {
                        if(detailsDivs[i].children[0].name == "h4" && detailsDivs[i].children[0].children[0].data == "Budget:") {
                            movie.budget = imdbHelper.parseCurrency(detailsDivs[i]);
                        }
                    }

                    if(detailsDivs[i].children[0].name == "h4" && detailsDivs[i].children[0].children[0].data == "Gross:") {
                        movie.gross = imdbHelper.parseCurrency(detailsDivs[i]);
                    }

                    if(detailsDivs[i].children[0].name == "h4" && detailsDivs[i].children[0].children[0].data == "Language:") {
                        var langLinks = htmlparser.DomUtils.getElementsByTagName("a", detailsDivs[i]);
                        movie.languages = [];
                        for (var t = 0; t < langLinks.length; t++) {
                            if(langLinks[t].attribs && langLinks[t].attribs.href.indexOf("/language/") == 0) {
                                movie.languages.push(langLinks[t].children[0].data.trim());
                            }
                        }
                    }
                }
                movie.uname = imdbHelper.getUname(movie);
                getDom(movie.url + 'fullcredits').then(function(castDom) {
                    movie.cast = getAllActors(castDom);
                    dfr.resolve(movie);
                });
            } catch(error) {
                dfr.reject(error);
            }
        });
        return dfr.promise;
    };

    self.readActor = function(url) {
        var dfr = q.defer();

        getDom(url).then(function(dom) {
            var actor = { url : url };
            try {
                var bioBox = htmlparser.DomUtils.getElementById("name-overview-widget", dom);

                var headers = htmlparser.DomUtils.getElementsByTagName("h1", bioBox);
                for (var i = 0; i < headers.length; i++) {
                    if(headers[i].attribs && headers[i].attribs.class == "header") {
                        actor.name = headers[i].children[0].children[0].data.trim();
                    }
                }
                var jobsDiv = htmlparser.DomUtils.getElementById("name-job-categories", dom);
                actor.jobs = [];
                if(jobsDiv != null) {
                    for (var i = jobsDiv.children.length - 1; i >= 0; i--) {
                        if(jobsDiv.children[i].name == "a") {
                            actor.jobs.push(jobsDiv.children[i].attribs.href.substring(1));
                        }
                    }
                }

                var bornInfo = htmlparser.DomUtils.getElementById("name-born-info", dom);
                if(bornInfo != null) {
                    for (var i = bornInfo.children.length - 1; i >= 0; i--) {
                        if(bornInfo.children[i].name == "a") {
                            if(bornInfo.children[i].attribs.href.indexOf("/search/") > -1) {
                                var birthPlace = bornInfo.children[i].children[0].data.trim().split(",");
                                actor.birthPlace = {};
                                for (var j = birthPlace.length - 1; j >= 0; j--) {
                                    birthPlace[j] = birthPlace[j].trim();
                                }
                                var birthPlaceLength = birthPlace.length;
                                actor.birthPlace.country = birthPlace[birthPlaceLength - 1];
                                if(birthPlaceLength > 1)
                                    actor.birthPlace.state = birthPlace[birthPlaceLength - 2];
                            } else {
                                actor.bornName = bornInfo.children[i].children[0].data.trim();
                            }
                        }
                        if(bornInfo.children[i].name == "time" && bornInfo.children[i].attribs && bornInfo.children[i].attribs.datetime)
                        {
                            actor.birthdate = bornInfo.children[i].attribs.datetime;
                        }
                    }
                    if(bornInfo.children[1].children[0].data)
                        actor.bornName = bornInfo.children[1].children[0].data.trim();
                }

                var moviesBox = htmlparser.DomUtils.getElementById("filmography", dom);
                var moviesDivs = htmlparser.DomUtils.getElementsByTagName("div", moviesBox);
                actor.movies = [];
                for (var i = 0; i < moviesDivs.length; i++) {
                    if( moviesDivs[i].attribs.class &&
                        moviesDivs[i].attribs.class.indexOf("filmo-row") > -1 &&
                        moviesDivs[i].attribs.id &&
                        (moviesDivs[i].attribs.id.indexOf("actor") > -1 || moviesDivs[i].attribs.id.indexOf("actress") > -1) &&
                        moviesDivs[i].children.length == 4 &&
                        moviesDivs[i].children[0].name == "span" &&
                        moviesDivs[i].children[0].attribs.class == "year_column" &&
                        moviesDivs[i].children[1].name == "b" &&
                        moviesDivs[i].children[1].children[0].name == "a"
                    ) {
                        var movie = {
                            year: parseInt(moviesDivs[i].children[0].children[0].data.trim().replace(/[^0-9]/g, "")),
                            title: moviesDivs[i].children[1].children[0].children[0].data.trim(),
                            url: "http://www.imdb.com" + moviesDivs[i].children[1].children[0].attribs.href.trim()
                        };
                        movie.url = movie.url.substring(0, movie.url.indexOf("?"));
                        movie.uname = imdbHelper.getUname(movie);
                        movie.imdbid = movie.uname.split('-');
                        movie.imdbid = movie.imdbid[movie.imdbid.length-1];
                        actor.movies.push(movie);
                    }
                }
                actor.uname = imdbHelper.getActorUname(actor);

                dfr.resolve(actor);
            } catch(error) {
                dfr.reject(error);
            }
        });

        return dfr.promise;
    };

    self.readShow = function(url) {
        var dfr = q.defer();

        getDom(url).then(function(dom) {
            var show = { url: url };
            try {
                var metaDataBox = htmlparser.DomUtils.getElementById("title-overview-widget-layout", dom);
                var titleDetailsBox = htmlparser.DomUtils.getElementById("titleDetails", dom);
                var titleStorylineBox = htmlparser.DomUtils.getElementById("titleStoryLine", dom);

                var headers = htmlparser.DomUtils.getElementsByTagName("h1", metaDataBox);
                for (var i = 0; i < headers.length; i++) {
                    if(headers[i].attribs && headers[i].attribs.class == "header") {
                        show.title = headers[i].children[0].children[0].data;
                        //show.year = parseInt(htmlparser.DomUtils.getElementsByTagName("a", headers[i])[0].children[0].data.trim());
                    }
                }

                var divs = htmlparser.DomUtils.getElementsByTagName("div", metaDataBox);
                for (var i = 0; i < divs.length; i++) {
                    if(divs[i].attribs) {
                        if(divs[i].attribs.class == "titlePageSprite star-box-giga-star") {
                            show.rating = parseFloat(divs[i].children[0].data);
                        }
                        if(divs[i].attribs.class == "infobar") {
                            var timeElement = htmlparser.DomUtils.getElementsByTagName("time", divs[i]);
                            if(timeElement && timeElement.length > 0 && timeElement[0].children.length > 0) {
                                //show.minutes = parseInt(timeElement[0].children[0].data.trim().split(' ')[0]);
                                var genres = htmlparser.DomUtils.getElementsByTagName("span", divs[i]);
                                show.genres = [];
                                for(var t = 0; t < genres.length; t++) {
                                    if(genres[t].attribs && genres[t].attribs.itemprop == "genre") {
                                        show.genres.push(genres[t].children[0].data.trim());
                                    }
                                }
                            }
                        }
                    }
                }

                var images = htmlparser.DomUtils.getElementsByTagName("img", metaDataBox);
                for (var i = 0; i < images.length; i++) {
                    if(images[i].attribs && images[i].attribs.itemprop == "image") {
                        show.image = {
                            height: parseInt(images[i].attribs.height),
                            width: parseInt(images[i].attribs.width),
                            src: images[i].attribs.src
                        };
                    }
                }

                var paragraphs = htmlparser.DomUtils.getElementsByTagName("p", titleStorylineBox);
                for (var i = 0; i < paragraphs.length; i++) {
                    if(paragraphs[i].attribs && paragraphs[i].attribs.itemprop == "description" && paragraphs[i].children.length > 0 && paragraphs[i].children[0].data) {
                        show.desc = paragraphs[i].children[0].data.trim();
                    }
                }

                var detailsDivs = htmlparser.DomUtils.getElementsByTagName("div", titleDetailsBox);
                for (var i = 0; i < detailsDivs.length; i++) {
                    if(detailsDivs[i].attribs && detailsDivs[i].attribs.class == "txt-block") {
                        if(detailsDivs[i].children[0].name == "h4" && detailsDivs[i].children[0].children[0].data == "Budget:") {
                            show.budget = imdbHelper.parseCurrency(detailsDivs[i]);
                        }
                    }

                    if(detailsDivs[i].children[0].name == "h4" && detailsDivs[i].children[0].children[0].data == "Gross:") {
                        show.gross = imdbHelper.parseCurrency(detailsDivs[i]);
                    }

                    if(detailsDivs[i].children[0].name == "h4" && detailsDivs[i].children[0].children[0].data == "Language:") {
                        var langLinks = htmlparser.DomUtils.getElementsByTagName("a", detailsDivs[i]);
                        show.languages = [];
                        for (var t = 0; t < langLinks.length; t++) {
                            if(langLinks[t].attribs && langLinks[t].attribs.href.indexOf("/language/") == 0) {
                                show.languages.push(langLinks[t].children[0].data.trim());
                            }
                        }
                    }
                }
                show.uname = imdbHelper.getUname(show);


                getDom(show.url + 'fullcredits').then(function(castDom) {
                    show.cast = getAllActors(castDom);
                    dfr.resolve(show);
                });

            } catch(error) {
                dfr.reject(error);
            }
        });
        return dfr.promise;
    };

    var getAllActors = function(castDom) {
        var cast = [];
        var mainSection = htmlparser.DomUtils.getElementById("main", castDom);
        var tables = htmlparser.DomUtils.getElementsByTagName("table", mainSection);

        for(var i = 0; i < tables.length; i++) {
            if(tables[i].attribs && tables[i].attribs.class && tables[i].attribs.class == "cast_list") {
                var castRows = tables[i].children;
                for (var i = 0; i < castRows.length; i++) {
                    if(castRows[i].attribs && castRows[i].attribs.class) {
                        var actor = {
                            name: castRows[i].children[1].children[0].children[0].children[0].data.trim(),
                            img: castRows[i].children[0].children[0].children[0].attribs.src.trim()
                        };
                        var actor_url = castRows[i].children[1].children[0];
                        if(actor_url.name == "a" && actor_url.attribs.href.indexOf("/name") > -1) {
                            var aurl = actor_url.attribs.href.trim();
                            var queryStringIndex = aurl.indexOf("?");
                            actor.imdbid = aurl.substring(0, queryStringIndex -1).replace('/name/', '');
                            actor.url = "http://www.imdb.com/name/" + actor.imdbid +"/";
                        }
                        if( castRows[i].children[3] &&
                            castRows[i].children[3].children &&
                            castRows[i].children[3].children[0].children
                        ) {
                            actor.character = castRows[i].children[3].children[0].children[0].children ?
                                castRows[i].children[3].children[0].children[0].children[0].data.trim() :
                                castRows[i].children[3].children[0].children[0].data.trim();
                        }
                        actor.uname = imdbHelper.getActorUname(actor);
                        cast.push(actor);
                    }
                }
                break;
            }
        }
        return cast;
    };
};

module.exports = new imdb();