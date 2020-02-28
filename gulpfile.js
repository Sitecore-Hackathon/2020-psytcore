/// <binding />
var gulp = require("gulp"),
    msbuild = require("gulp-msbuild"),
    debug = require("gulp-debug"),
    foreach = require("gulp-foreach"),
    rename = require("gulp-rename"),
    watch = require("gulp-watch"),
    merge = require("merge-stream"),
    newer = require("gulp-newer"),
    util = require("gulp-util"),
    syncExec = require('sync-exec'),
    runSequence = require("run-sequence"),
    path = require("path"),
    config = require("./gulp-config.js")(),
    nugetRestore = require("gulp-nuget-restore"),
    fs = require("fs"),
    yargs = require("yargs").argv,
    del = require("del"),
    flatten = require("gulp-flatten"),
    //tds = require("./scripts/tds.js"),
    nunit = require("gulp-nunit-runner"),
    xunit = require("gulp-xunit-runner"),
    //powershell = require("./scripts/Powershell.js"),
    wait = require("gulp-wait"),
    es = require("event-stream"),
    toAbsolutePath = require('to-absolute-path'),
    browserSync = require('browser-sync').create();

try {
    config = require("./gulp-config-user.js")();
} catch (er) {

}

module.exports.config = config;
gulp.task("print-config", function (callback) {
    console.log(config);
});


gulp.task("default", function (callback) {
    return runSequence(
        "00_Full-Local-Deploy",
        callback);
});

gulp.task("00_Full-Local-Deploy", function (callback) {
    config.runCleanBuilds = true;
    config.buildConfiguration = "Debug";

    return runSequence(
        "01-Nuget-Restore",
        "02-Publish-All-Projects",
        //"Run-NUnit-Tests",
        "03_Remove-EnvironmentSpecific-Configs",
        "04-Apply-Xml-Transform",
        "Copy-Support-Assemblies",
        "Publish-Html",
        "Publish-Images",
        callback);
});

gulp.task("00_CI-Build", function () {
    config.runCleanBuilds = true;
    config.buildConfiguration = "Release";

    return runSequence("Build-Solution");
});

gulp.task("00_CI-Publish", function () {
    config.runCleanBuilds = true;
    config.buildConfiguration = "Release";
    config.websiteRoot = __dirname + config.ciReleasePath;

    return runSequence(
    "Publish-Foundation-Projects",
    "Publish-Feature-Projects",
    "Publish-Project-Projects",
    "04-Apply-Xml-Transform",
    "Copy-Support-Assemblies",
    "Daily-Copy-Solution-Nuspec-File");
});

gulp.task("00_CI-Publish-Sitecore-Packages", function () {
    config.buildConfiguration = "Release";
    config.websiteRoot = __dirname + config.ciReleasePath;

    return runSequence("06-Deploy-TDS-Update-Packages");
});

gulp.task("00_Daily-Build", function () {
    config.runCleanBuilds = true;
    config.buildConfiguration = "Release";
    config.websiteRoot = __dirname + config.ciReleasePath;

    return runSequence(
    "Clean-Source-TDS-Update-Packages",
    "02-Publish-All-Projects",
    "04-Apply-Xml-Transform",
    "06-Deploy-TDS-Update-Packages",
    "Copy-Support-Assemblies",
    "Daily-Copy-Solution-Nuspec-File");
});

/*****************************
  Initial setup
*****************************/

gulp.task("01-Nuget-Restore", function (callback) {
    var solutionFilePath = config.solutionFolder + "/" + config.solutionName + ".sln";

    return gulp.src(solutionFilePath).pipe(nugetRestore());
});

gulp.task("02-Publish-All-Projects", function (callback) {
    return runSequence(
        "Build-Solution",
        "Publish-Foundation-Projects",
        "Publish-Feature-Projects",
        "Publish-Project-Projects",
        callback);
});

gulp.task("03_Remove-EnvironmentSpecific-Configs", function () {
    var root = config.websiteRoot + "/**/App_Config",
        environmentFiles = [],
        filePattern = "";

    environmentFiles = config.deploymentEnvironments.map(function (environment) {
        filePattern = root + "/**/*." + environment + ".config";
        console.log("Removing config files from " + filePattern);

        return filePattern;
    });

    return del(environmentFiles, { force: true });
});

gulp.task("04-Apply-Xml-Transform", function () {
    var includeRoot = config.solutionFolder;
    var excludeRoot = "!" + includeRoot;

    var layerPathFilters = [includeRoot + "/Foundation/**/*.transform", includeRoot + "/Feature/**/*.transform", includeRoot + "/Project/**/*.transform", excludeRoot + "/**/obj/**/*.transform", excludeRoot + "/**/bin/**/*.transform", excludeRoot + "/**/*Test*/**/*.transform"],
                   streams = [];

    if (config.buildConfiguration === "Debug") {
        layerPathFilters = layerPathFilters.concat([includeRoot + "/Foundation/**/*.Debug.config", includeRoot + "/Feature/**/*.Debug.config", includeRoot + "/Project/**/*.Debug.config", excludeRoot + "/**/obj/**/*.Debug.config", excludeRoot + "/**/bin/**/*.Debug.config", excludeRoot + "/**/*Test*/**/*.Debug.config"]);
    }

    if (config.buildConfiguration === "Release") {
        layerPathFilters = layerPathFilters.concat([includeRoot + "/Foundation/**/*.Release.config", includeRoot + "/Feature/**/*.Release.config", includeRoot + "/Project/**/*.Release.config", excludeRoot + "/**/obj/**/*.Release.config", excludeRoot + "/**/bin/**/*.Release.config", excludeRoot + "/**/*Test*/**/*.Release.config"]);
    }

    console.log(layerPathFilters);
    streams.push(applyXmlTransforms(layerPathFilters));

    return es.merge(streams);
});

var applyXmlTransforms = function (layerPathFilters, configSufix) {
    return gulp.src(layerPathFilters)
        .pipe(foreach(function (stream, file) {
            var fileToTransform = file.path
                .replace(/.+code\\(.+)\.transform/, "$1")
                .replace(/.+code\\(.+).Debug/, "$1")
                .replace(/.+code\\(.+).Release/, "$1");

            if (configSufix) {
                fileToTransform = insertBeforeLastOccurenceOf(fileToTransform, ".", configSufix);
            }

            util.log("Applying configuration transform: " + file.path);
            util.log("fileToTransform: " + fileToTransform);
            return gulp.src("./scripts/applytransform.targets")
                .pipe(msbuild({
                    targets: ["ApplyTransform"],
                    configuration: config.buildConfiguration,
                    logCommand: false,
                    verbosity: "minimal",
                    stdout: true,
                    errorOnFail: true,
                    maxcpucount: 0,
                    toolsVersion: 15.0,
                    properties: {
                        WebConfigToTransform: config.websiteRoot,
                        TransformFile: file.path,
                        FileToTransform: fileToTransform
                    }
                }));
        }));
}

var insertBeforeLastOccurenceOf = function (word, pattern, toInsert)
{
    var position = word.lastIndexOf(pattern);
    return [word.slice(0, position), pattern, toInsert, word.slice(position)].join("");
}

gulp.task("05-Deploy-Transforms", function () {
    return gulp.src(config.solutionFolder + "/**/code/**/*.transform")
        .pipe(gulp.dest(config.websiteRoot + "/temp/transforms"));
});

gulp.task("06-Deploy-TDS-Update-Packages", function (callback) {
    return runSequence(
        "Clean-Destination-TDS-Update-Packages",
        "Copy-TDS-Update-Packages",
        callback);
});

gulp.task("Daily-Copy-Solution-Nuspec-File", function () {
    return gulp.src(config.nunspecFilePath)
        .pipe(gulp.dest(__dirname + config.ciReleasePath));
});

/*****************************
  Run tests
*****************************/
gulp.task("Run-NUnit-Tests", function () {
    return runTests(nunit, '*.Tests.dll', config.nunitRunner);
});

gulp.task("Run-XUnit-Tests", function () {
    return runTests(xunit, '*.TestsXunit.dll', config.xunitRunner);
});

var runTests = function (runnerModule, testsNamePattern, runnerExePath) {

    return gulp.src([config.solutionFolder + '/**/bin/' + config.buildConfiguration + '/' + testsNamePattern], { read: false })
        .pipe(runnerModule({
            executable: __dirname + runnerExePath
        }));
}

/*****************************
  Deploy TDS Update packages tasks
*****************************/

/*
gulp.task("00_Full-TDS-Local-Deploy", function () {
    config.runCleanBuilds = true;
    config.buildConfiguration = "Release";
    config.sitecorePackageDiffDeployment = false;

    return runSequence(
        "Clean-Source-TDS-Update-Packages",
        "Build-Solution",
        "06-Deploy-TDS-Update-Packages",
        "Install-TDS-Update-Packages",
        "Clean-Destination-TDS-Update-Packages");
});
*/

gulp.task("Install-TDS-Update-Packages", function () {
    setTimeout(function () {
        const scriptParameters = ' -tdsPackageInstaller \'' + path.join(__dirname, config.tdsPackageInstaller) + '\' -tdsUpdatePackagesRootFolder ' + path.join(config.websiteRoot, config.tdsUpdatePackagesRootFolder) + ' -sitecoreDeployFolder ' + config.websiteRoot + ' -sitecoreUrl \'' + config.websiteUrl + '\'' + ' -tdsPackageInstallerTimeoutSeconds ' + config.tdsPackageInstallerTimeoutSeconds;

        var pathToAddProjectScript = path.join(__dirname, 'scripts/Install-TdsUpdatePackages.ps1');
        powershell.runAsync(pathToAddProjectScript, scriptParameters);
    }, 1500, 'wait for tds deploy to complete');
});

gulp.task("Copy-TDS-Update-Packages", function () {

    var copyTDSUpdatePackages = function(tdsProjectsPath, destinationPath) {

        var pad = function(number, size) {
            var s = number + "";

            while (s.length < size) {
                s = "0" + s;
            }

            return s;
        };

        var getNumberOfDigits = function(number) {
            return number.toString().length;
        };

        var getChangedProjectsFromGitHistory = function() {

            var output = syncExec('git diff master HEAD --name-only');

            var regex = /^src\/(Feature|Foundation|Project)\/([^/]+)\/.+?$/gim;
            var outputArray = [];
            var match = regex.exec(output.stdout);
            while (match != null) {

                var moduleName = "sc-hack-2020sc." + match[1] + "." + match[2];

                if (outputArray.indexOf(moduleName) === -1) {
                    outputArray.push(moduleName);
                }

                match = regex.exec(output.stdout);
            }

            return outputArray;
        };

        var getSitecorePackageRoots = function (root) {

            if (config.sitecorePackageDiffDeployment) {
                return getChangedProjectsFromGitHistory().map(function (moduleName) {
                                return root + "/**/serialisation/tds/*/bin/Package_Release/" + moduleName + "*.update";
                            });
            }
            else
            {
                return [root + "/**/serialisation/tds/**/*.update"];
            }
        };

        var orderedTdsProjects = tds.getTopologicalSortedProjects(tdsProjectsPath, true),
            root = tdsProjectsPath,
            roots = getSitecorePackageRoots(root);

        // Adding exclusions
        roots.push("!" + root + "/**/serialisation/tds/**/*LocalContent*.update");

        console.log(roots)
        return gulp.src(roots, { base: root })
            .pipe(flatten())
            .pipe(rename(function(path) {
                var tdsProjectName = path.basename,
                    tdsProjectUpdateOrder = orderedTdsProjects.indexOf(tdsProjectName),
                    maxOrderNumSize = getNumberOfDigits(orderedTdsProjects.length),
                    orderPrefix = pad(tdsProjectUpdateOrder, maxOrderNumSize);

                path.basename = orderPrefix + "." + path.basename;
            }))
            .pipe(gulp.dest(config.websiteRoot + destinationPath));
    };

    var subTasks = [];

    subTasks.push(copyTDSUpdatePackages(config.solutionFolder + "/Foundation", "/temp/TDS_Update_Packages/01.Foundation"));
    subTasks.push(copyTDSUpdatePackages(config.solutionFolder + "/Feature", "/temp/TDS_Update_Packages/02.Feature"));
    subTasks.push(copyTDSUpdatePackages(config.solutionFolder + "/Project", "/temp/TDS_Update_Packages/03.Project"));

    return subTasks;
});

gulp.task("Clean-Destination-TDS-Update-Packages", function () {
    return del([config.websiteRoot + "/temp/TDS_Update_Packages/**"], { force: true });
});

gulp.task("Clean-Source-TDS-Update-Packages", function () {
    return del([config.solutionFolder + "/**/serialisation/tds/*/bin/Package_Release/*.update"], { force: true });
});

/*****************************
  Publish
*****************************/
var publishStream = function (stream, dest) {
    var targets = ["Build"];

    return stream
        .pipe(debug({ title: "Building project:" }))
        .pipe(msbuild({
            targets: targets,
            configuration: config.buildConfiguration,
            logCommand: false,
            verbosity: "minimal",
            stdout: true,
            errorOnFail: true,
            maxcpucount: 0,
            toolsVersion: 15.0,
            properties: {
                DeployOnBuild: "true",
                DeployDefaultTarget: "WebPublish",
                WebPublishMethod: "FileSystem",
                DeleteExistingFiles: "false",
                publishUrl: dest,
                _FindDependencies: "false",
                ExcludeFilesFromDeployment: config.ExcludeFilesFromDeployment
            }
        }));
}

var publishProject = function (location, dest) {
    dest = dest || config.websiteRoot;

    console.log("publish to " + dest + " folder");

    return gulp.src([config.solutionFolder + "/" + location + "/code/*.csproj"])
        .pipe(foreach(function (stream, file) {
            return publishStream(stream, dest);
        }));
}

var publishProjects = function (location, dest) {
    dest = dest || config.websiteRoot;

    console.log("publish to " + dest + " folder");

    return gulp.src([location + "/**/code/*.csproj", location + "/**/code/**/*.BlogSite.csproj"])
        .pipe(foreach(function (stream, file) {
            return publishStream(stream, dest);
        }));
};

gulp.task("Build-Solution", function () {
    var targets = ["Build"],
        solution = config.solutionFolder + "/" + config.solutionName + ".sln";

    if (yargs && yargs.buildConfiguration && typeof (yargs.buildConfiguration) == "string") {
        config.buildConfiguration = yargs.buildConfiguration;
    }

    if (config.runCleanBuilds) {
        targets = ["Clean", "Build"];
    }
    console.log("Solution path: " + solution + " Configuration mode: " + config.buildConfiguration);
    return gulp.src(solution)
        .pipe(msbuild({
            targets: targets,
            configuration: config.buildConfiguration,
            logCommand: false,
            verbosity: "minimal",
            stdout: true,
            errorOnFail: true,
            maxcpucount: 0,
            toolsVersion: 15.0
        }));
});

gulp.task("Publish-Foundation-Projects", function () {
    return publishProjects(config.solutionFolder + "/Foundation");
});

gulp.task("Publish-Feature-Projects", function () {
    return publishProjects(config.solutionFolder + "/Feature");
});

gulp.task("Publish-Project-Projects", function () {
    return publishProjects(config.solutionFolder + "/Project");
});

gulp.task("Publish-Project", function () {
    if (yargs && yargs.m && typeof (yargs.m) == "string") {
        return publishProject(yargs.m);
    } else {
        throw "\n\n------\n USAGE: -m Layer/Module \n------\n\n";
    }
});

gulp.task("Publish-Assemblies", function () {
    var root = config.solutionFolder;
    var binFiles = root + "/**/code/**/bin/" + config.solutionName + ".{Feature,Foundation,Project}.*.{dll,pdb}";
    var destination = config.websiteRoot + "/bin/";
    return gulp.src(binFiles, { base: root })
        .pipe(rename({ dirname: "" }))
        .pipe(newer(destination))
        .pipe(debug({ title: "Copying " }))
        .pipe(gulp.dest(destination));
});

gulp.task("Publish-All-Views", function () {
    var root = config.solutionFolder;
    var roots = [root + "/**/Views", "!" + root + "/**/obj/**/Views"];
    var files = "/**/*.cshtml";
    var destination = config.websiteRoot + "\\Views";
    return gulp.src(roots, { base: root }).pipe(
        foreach(function (stream, file) {
            console.log("Publishing from " + file.path);
            gulp.src(file.path + files, { base: file.path })
                .pipe(newer(destination))
                .pipe(debug({ title: "Copying " }))
                .pipe(gulp.dest(destination));
            return stream;
        })
    );
});

gulp.task("Publish-All-Configs", function () {
    var root = config.solutionFolder;
    var roots = [root + "/**/App_Config", "!" + root + "/**/obj/**/App_Config"];
    var files = "/**/*.config";
    var destination = config.websiteRoot + "\\App_Config";
    return gulp.src(roots, { base: root }).pipe(
        foreach(function (stream, file) {
            console.log("Publishing from " + file.path);
            gulp.src(file.path + files, { base: file.path })
                .pipe(newer(destination))
                .pipe(debug({ title: "Copying " }))
                .pipe(gulp.dest(destination));
            return stream;
        })
    );
});

/*****************************
 Copy Support Assemblies
*****************************/
gulp.task("Copy-Support-Assemblies", function () {
 
    var destination = config.websiteRoot + "/bin/";

    return gulp.src(config.supportAssemblies)
        .pipe(rename({ dirname: "" }))
        .pipe(newer(destination))
        .pipe(debug({ title: "Copying " }))
        .pipe(gulp.dest(destination));
});

/*****************************
 Watchers
*****************************/
gulp.task("Auto-Publish-Css", function () {
    var root = config.solutionFolder,
        roots = [root + "/**/Styles", "!" + root + "/**/obj/**/Styles"],
        files = "/**/*.css",
        destination = config.websiteRoot + "\\Styles";

    gulp.src(roots, { base: root }).pipe(
        foreach(function (stream, rootFolder) {
            gulp.watch(rootFolder.path + files, function (event) {
                if (event.type === "changed") {
                    console.log("publish this file " + event.path);
                    gulp.src(event.path, { base: rootFolder.path }).pipe(gulp.dest(destination));
                    browserSync.reload();
                }
                console.log("published " + event.path);
            });
            return stream;
        })
    );
});

gulp.task("Auto-Publish-Js", function () {
    var root = config.solutionFolder,
        roots = [root + "/**/Scripts", "!" + root + "/**/obj/**/Scripts"],
        files = "/**/*.js",
        destination = config.websiteRoot + "\\Scripts";

    gulp.src(roots, { base: root }).pipe(
        foreach(function (stream, rootFolder) {
            gulp.watch(rootFolder.path + files, function(event) {
                if (event.type === "changed") {
                    console.log("publish this file " + event.path);
                    gulp.src(event.path, { base: rootFolder.path }).pipe(gulp.dest(destination));
                    browserSync.reload();
                }
                console.log("published " + event.path);
            });
            return stream;
        })
    );
});

gulp.task("Auto-Publish-Views", function () {
    var root = config.solutionFolder,
        roots = [root + "/**/Views", "!" + root + "/**/obj/**/Views"],
        files = "/**/*.cshtml",
        destination = config.websiteRoot + "\\Views";

    gulp.src(roots, { base: root }).pipe(
        foreach(function (stream, rootFolder) {
            gulp.watch(rootFolder.path + files, function (event) {
                if (event.type === "changed") {
                    console.log("publish this file " + event.path);
                    gulp.src(event.path, { base: rootFolder.path }).pipe(gulp.dest(destination));
                    browserSync.reload();
                }
                console.log("published " + event.path);
            });
            return stream;
        })
    );
});

gulp.task("Auto-Publish-Assemblies", function () {
    var root = config.solutionFolder;
    var roots = [root + "/**/code/**/bin"];
    var files = "/**/" + config.solutionName + ".{Feature,Foundation,Project}.*.{dll,pdb}";
    var destination = config.websiteRoot + "/bin/";
    gulp.src(roots, { base: root }).pipe(
        foreach(function (stream, rootFolder) {
            gulp.watch(rootFolder.path + files, function (event) {
                if (event.type === "changed") {
                    console.log("publish this file " + event.path);
                    gulp.src(event.path, { base: rootFolder.path }).pipe(gulp.dest(destination));
                }
                console.log("published " + event.path);
            });
            return stream;
        })
    );
});

/*****************************
 FE Tasks
*****************************/
gulp.task('Auto-Publish-Html', function () {
    var root = config.solutionFolder,
        roots = [root + '/**/Markup'],
        files = '/*.html',
        destination = config.websiteRoot + '\\Markup';

    config.buildConfiguration = 'debug';

    gulp.src(roots, { base: root }).pipe(
        foreach(function (stream, rootFolder) {
            gulp.watch(rootFolder.path + files, function (event) {
                if (event.type === 'changed') {
                    console.log('publish this file ' + event.path);
                    gulp.src(event.path, { base: rootFolder.path }).pipe(gulp.dest(destination));
                    browserSync.reload();
                }
                console.log('published ' + event.path);
            });
            return stream;
        })
    );
});

gulp.task('Publish-Html', function () {
    var destination = config.websiteRoot + '\\Markup';

    config.buildConfiguration = 'debug';

    return gulp.src(config.solutionFolder + '/**/Markup/**/*')
        .pipe(foreach(function (stream, file) {
            console.log('Publishing: ' + file.path);
            gulp.src(file.path)
                .pipe(gulp.dest(destination));
            return stream;
        }));
});

gulp.task('Publish-Images', function () {
    var destination = config.websiteRoot + '\\Images\\CONTENT_IMAGES';

    config.buildConfiguration = 'debug';

    return gulp.src(config.solutionFolder + '/**/Images/CONTENT_IMAGES/*')
        .pipe(foreach(function (stream, file) {
            console.log('Publishing: ' + file.path);
            gulp.src(file.path)
                .pipe(gulp.dest(destination));
            return stream;
        }));
});

/*****************************
 Browser sync
*****************************/
gulp.task('browser-sync', function () {
    browserSync.init();

    return runSequence(
    "Auto-Publish-Html",
    "Auto-Publish-Views",
    "Auto-Publish-Css",
    "Auto-Publish-Js");
});
