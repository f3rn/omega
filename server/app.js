var express = require('express'),
	_ = require('underscore'),

	issueDao = require('./lib/issueDao'),
	historyDao = require('./lib/historyDao'),
	projectDao = require('./lib/projectDao'),
	tracker = require('./lib/tracker');

// command line parameters
var argv = require('optimist')
	.options('port', {
		alias: 'p',
		default: 1337
	})
	.options('password', {
		alias: 'pass',
		default: 'admin'
	})
	// TODO: get r.js optimizer going again and run on startup (according to NODE_ENV)
	.options('optimized', {
		alias: 'opt',
		default: false
	})
	.argv;

var version = require('../package.json').version;
var port = process.env.app_port || argv.port;
var password = process.env.admin_pass || argv.password;
var www_public = '/../public';

var db_dir = __dirname + '/../db/';
if (process.env['NODE_ENV'] === 'nodester') {
	db_dir = __dirname + '/../'; // override due to https://github.com/nodester/nodester/issues/313
}
projectDao.init(db_dir);
issueDao.init(db_dir);

var app = express.createServer();

app.configure('development', function () {
	console.log('Starting development server');

	var lessMiddleware = require('less-middleware');
	app.use(lessMiddleware({
		debug: true,
		src: __dirname + '/server',
		dest: __dirname + '/public'
	}));
});

app.configure(function () {
	app.set('views', __dirname + '/../views');
	app.register('.html', require('ejs')); // call our views html

	app.use(express.logger());
	app.use(express.cookieParser());
	app.use(express.session({ secret: 'nyan cat' })); // for flash messages
	app.use(express.static(__dirname + www_public));

	app.use(express.bodyParser());
	app.use(express.methodOverride());
	app.use(app.router);
});

app.listen(port);

// TODO: extract routes elsewhere

app.get('/', function (req, res) {
	var unlistedCount = projectDao.findUnlisted().length;
	res.render('index.html', viewOptions({
		projects: projectDao.findListed(),
		unlisted: unlistedCount
	}));
});
app.post('/project', function (req, res) {
	var name = req.body.projectName;
	if (!name) {
		res.json({ error: 'empty' }, 400);
		return;
	} else if (!projectDao.isValidName(name)) {
		res.json({ error: 'invalid' }, 400);
		return;
	}

	if (projectDao.exists(name)) {
		res.json({ error: 'exists', url: '/project/'  + projectDao.getSlug(name) }, 409); // Conflict
	} else {
		var created = projectDao.create(name, !!req.body.unlisted);
		tracker.listen(created);
		var message = created.unlisted ? "Here's your project. Remember: it's unlisted, so nobody'll find it unless you share the address." : "Here's your project.";
		req.flash('info', message);
		res.json({ url: '/project/' + created.slug });
	}
});
app.get('/project', function (req, res) {
	res.statusCode = 404;
	res.end('Nothing to see here. Try /project/<name>');
});
app.get('/project/:slug', function (req, res) {
	var project = projectDao.find(req.params.slug);
	if (project && !project.deleted) {
		var flash = req.flash('info');
		var message = flash.length ? _.first(flash) : null;

		res.render('project.html', viewOptions({
			title: project.name,
			flash: message,
			noindex: project.unlisted
		}));
	} else if (project && project.deleted) {
		res.statusCode = 410; // Gone
		res.end('Project deleted');
	} else {
		res.statusCode = 404;
		res.end('No such project');
	}
});
app.get('/project/:slug/export', function (req, res) {
	var project = projectDao.find(req.params.slug);
	var filename = project.name + '.json';
	res.setHeader('Content-disposition', 'attachment; filename=' + filename);
	res.json(issueDao.load(project));
});


var auth = express.basicAuth('admin', password);

app.get('/admin', auth, function (req, res) {
	var projects = _.map(projectDao.findAll(), function (project) {
		project.issueCount = issueDao.count(project);
		return project;
	});
	res.render('admin.html', viewOptions({
		projects: projects,
		flash: req.flash(),
		noindex: true
	}));
});

app.put('/project/:slug', auth, function (req, res) {
	var original = projectDao.find(req.params.slug);

	var updated = {};
	_.each(['unlisted', 'deleted'], function (prop) {
		var set = req.body[prop] === 'on';
		updated[prop] = set;
	});
	var success = projectDao.update(req.params.slug, updated);
	buildAdminFlashMessage(req, original, 'update', success);
	res.redirect('back');
});

app.delete('/project/:slug/issues', auth, function (req, res) {
	var project = projectDao.find(req.params.slug);
	issueDao.reset(project);
	historyDao.reset(project);
	req.flash('info', 'All issues in project \'' + project.name + '\' have been deleted.');

	res.redirect('back');
});

function buildAdminFlashMessage(req, project, action, success) {
	var type = success ? 'info' : 'error';
	var message = success ? 'Project \'' + project.name + '\' has been ' + action + 'd.' : 'Oops, could not ' + action + ' \'' + project.name + '\'';
	req.flash(type, message);
}

function viewOptions(options) {
	return _.extend({}, { version: version }, options);
}

tracker.init(app);

console.log('Ω v' + version + ' running on port ' + port);