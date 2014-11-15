# node-twitter #


Simple module for using Twitter's API in node.js


## Installation ##


`npm install node-twitter-api`

## Usage ##

### Step 1: Initialization ###
```javascript
var twitterAPI = require('node-twitter-api');
var twitter = new twitterAPI({
	consumerKey: 'your consumer Key',
	consumerSecret: 'your consumer secret',
	callback: 'http://yoururl.tld/something'
});
```
### Step 2: Getting a request token ###
```javascript
twitter.getRequestToken(function(error, requestToken, requestTokenSecret, results){
	if (error) {
		console.log("Error getting OAuth request token : " + error);
	} else {
		//store token and tokenSecret somewhere, you'll need them later; redirect user
	}
});
```
If no error has occured, you now have a `requestToken` and a `requestTokenSecret`. You should store them somewhere (e.g. in a session, if you are using express), because you will need them later to get the current user's access token, which is used for authentification.

### Step 3: Getting an Access Token ###
Redirect the user to `https://twitter.com/oauth/authenticate?oauth_token=[requestToken]`. `twitter.getAuthUrl(requestToken)` also returns that URL.
If he allows your app to access his data, Twitter will redirect him to your callback-URL (defined in Step 1) containing the get-parameters: `oauth_token` and `oauth_verifier`. You can use `oauth_token` (which is the `requestToken` in Step 2) to find the associated `requestTokenSecret`. You will need `requestToken`, `requestTokenSecret` and `oauth_verifier` to get an Access Token.
```javascript
twitter.getAccessToken(requestToken, requestTokenSecret, oauth_verifier, function(error, accessToken, accessTokenSecret, results) {
	if (error) {
		console.log(error);
	} else {
		//store accessToken and accessTokenSecret somewhere (associated to the user)
		//Step 4: Verify Credentials belongs here
	}
});
```
If no error occured, you now have an `accessToken` and an `accessTokenSecret`. You need them to authenticate later API-calls.

### Step 4: (Optional) Verify Credentials ###
```javascript
twitter.verifyCredentials(accessToken, accessTokenSecret, function(error, data, response) {
	if (error) {
		//something was wrong with either accessToken or accessTokenSecret
		//start over with Step 1
	} else {
		//accessToken and accessTokenSecret can now be used to make api-calls (not yet implemented)
		//data contains the user-data described in the official Twitter-API-docs
		//you could e.g. display his screen_name
		console.log(data["screen_name"]);
	}
});
```

## Methods ##
(Allmost) all function names replicate the endpoints of the Twitter API 1.1.
If you want to post a status e. g. - which is done by posting data to statuses/update - you can just do the following:
```javascript
twitter.statuses("update", {
		status: "Hello world!"
	},
	accessToken,
	accessTokenSecret,
	function(error, data, response) {
		if (error) {
			// something went wrong
		} else {
			// data contains the data sent by twitter
		}
	}
);
```

Most of the functions use the scheme:
`twitter.[namespace]([type], [params], [accessToken], [accessTokenSecret], [callback]);`
* _namespace_ is the word before the slash (e.g. "statuses", "search", "direct_messages" etc.)
* _type_ is the word after the slash (e.g. "create", "update", "show" etc.)
* _params_ is an object containing the parameters you want to give to twitter (refer to the Twitter API Documentation for more information)
* _accessToken_ and _accessTokenSecret_ are the token and secret of the authenticated user
* _callback_ is a function with the parameters _error_ (either null or an error object), _data_ (data object) and _response_ (unprocessed response from Twitter)

For Timelines you can also use the function _getTimeline_ instead of _statuses_ and use shorter types ("user" instead of "user_timeline").
For Streams you must use _getStream_ which has two instead of just one callback: a dataCallback and an endCallback. (c.f. data and end events of node's http response)

## Use of update_with_media ##
(works similar for update_profile_image)
To send media alongside a tweet you just call the method as specified before. Please note, that you have to specify the parameters slightly different than proposed by the Twitter API documentation:
```javascript
{
	media: [
		"path_to_file1",
		"path_to_file2",
		stream
	],
	status: "Hello World"
},
```
Instead of specifing "media[]", you use a real array. The given paths will then be read and posted to the Twitter API. You can also use a Readable Stream (http://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options) instead of a Path.
Please note that Twitter only allows one image at the moment (the last one specified will be used).
