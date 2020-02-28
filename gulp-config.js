module.exports = function () {
    var instanceRoot = "C:\\inetpub\\wwwroot";
    var config = {
        websiteUrl: "https://sc-hack-2020sc.dev.local",
        websiteRoot: instanceRoot + "\\Website",
        licensePath: instanceRoot + "\\Data\\license.xml",
        solutionName: "Hackathon.Boilerplate",
        solutionFolder: "./src",
        supportAssemblies: "./libs/**/*.{dll,xml}",
        buildConfiguration: "Debug",
        nunspecFilePath: "./src/2020-psytcore.nuspec",
        runCleanBuilds: false,
        sitecorePackageDiffDeployment: false,
        deploymentEnvironments: ["Release"],
        ciReleasePath: "\\Release",
        nunitRunner: "\\deploy\\tools\\NUnit.ConsoleRunner.3.5.0\\nunit3-console.exe",
        xunitRunner: "\\deploy\\tools\\xunit.runner.console.2.2.0\\xunit.console.exe",
        tdsPackageInstaller: "\\deploy\\tools\\TDS\\PackageInstaller.exe",
        tdsUpdatePackagesRootFolder: "\\temp\\TDS_Update_Packages",
        tdsPackageInstallerTimeoutSeconds: 300,
        ExcludeFilesFromDeployment: "web.config.transform"
    };

    return config;
}