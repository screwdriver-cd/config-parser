'use strict';

const Hoek = require('hoek');
const clone = require('clone');
const TEMPLATE_REGEX = require('screwdriver-data-schema').config.regex.FULL_TEMPLATE_NAME;
const NAME_MATCH = 1;
const VERSION_MATCH = 3;
const LABEL_MATCH = 7;

/**
 * Merge oldJob into newJob
 * "oldJob" takes precedence over "newJob". For ex: individual job settings vs shared settings
 * @param  {Object}   newJob    Job to be merged into. For ex: shared settings
 * @param  {Object}   oldJob    Job to merge. For ex: individual job settings
 */
function merge(newJob, oldJob) {
    // Intialize new job with default fields (environment, settings, and secrets)
    newJob.environment = newJob.environment || {};
    newJob.settings = newJob.settings || {};

    // Merge
    Object.assign(newJob.environment, oldJob.environment || {});
    Object.assign(newJob.settings, oldJob.settings || {});
    newJob.image = oldJob.image || newJob.image;

    // Merge secrets
    const newSecrets = newJob.secrets || [];
    const oldSecrets = oldJob.secrets || [];

    newJob.secrets = [...new Set([...newSecrets, ...oldSecrets])];  // remove duplicate
}

/**
 * Overlays the fields specified in a specific job on top of the defaults in shared
 *
 * @method flattenSharedIntoJobs
 * @param  {Job}          shared A kind of default Job template
 * @param  {Object}       jobs   Object with all the jobs
 * @return {Object}              New object with jobs after merging
 */
function flattenSharedIntoJobs(shared, jobs) {
    const newJobs = {};

    Object.keys(jobs).forEach((jobName) => {
        const newJob = clone(shared);
        const oldJob = clone(jobs[jobName]);

        // Replace
        ['image', 'matrix', 'steps', 'template'].forEach((key) => {
            if (oldJob[key]) {
                newJob[key] = oldJob[key];
            }
        });

        merge(newJob, oldJob);
        newJobs[jobName] = newJob;
    });

    return newJobs;
}

/**
 * Retrieve template and merge into job config
 *
 * @method mergeTemplateIntoJob
 * @param  {String}           jobName           Job name
 * @param  {Object}           jobConfig         Job config
 * @param  {Object}           newJobs           Object with all the jobs
 * @param  {TemplateFactory}  templateFactory   Template Factory to get templates
 * @return {Promise}
 */
function mergeTemplateIntoJob(jobName, jobConfig, newJobs, templateFactory) {
    const matched = TEMPLATE_REGEX.exec(jobConfig.template);
    const name = matched[NAME_MATCH];
    const version = matched[VERSION_MATCH];
    const label = matched[LABEL_MATCH] ? matched[LABEL_MATCH].slice(1) : '';
    const oldJob = jobConfig;

    // Try to get the template
    return templateFactory.getTemplate({ name, version, label })
        .then((template) => {
            if (!template) {
                const labelText = label ? ` with label '${label}'` : '';

                throw new Error(`Template ${name}@${version}${labelText} does not exist`);
            }

            const newJob = template.config;

            merge(newJob, oldJob);
            delete newJob.template;
            newJobs[jobName] = newJob;

            return null;
        });
}

/**
 * Goes through each job and if template is specified, then merge into job config
 *
 * @method flattenTemplates
 * @param  {Object}           jobs              Object with all the jobs
 * @param  {TemplateFactory}  templateFactory   Template Factory to get templates
 * @return {Promise}          Resolves to new object with jobs after merging templates
 */
function flattenTemplates(jobs, templateFactory) {
    const newJobs = {};
    const templates = [];

    // eslint-disable-next-line
    Object.keys(jobs).forEach((jobName) => {
        const jobConfig = clone(jobs[jobName]);
        const templateConfig = jobConfig.template;

        // If template is specified, then merge
        if (templateConfig) {
            templates.push(mergeTemplateIntoJob(jobName, jobConfig, newJobs, templateFactory));
        } else {
            newJobs[jobName] = jobConfig;   // Otherwise just use jobConfig
        }
    });

    // Wait until all promises are resolved
    return Promise.all(templates)
        .then(() => newJobs);
}

/**
 * Converts complex environment variables like objects or arrays into JSON-ified strings
 *
 * This is because YAML allows you to define complex structures easily, but our input to the shell
 * is just simple strings (environment variables).
 * @method cleanComplexEnvironment
 * @param  {Object}       jobs   Object with all the jobs
 * @return {Object}              Updated object with jobs after cleaning
 */
function cleanComplexEnvironment(jobs) {
    Object.keys(jobs).forEach((jobName) => {
        const environment = Hoek.reach(jobs, `${jobName}.environment`, {
            default: {}
        });

        Object.keys(environment).forEach((varName) => {
            switch (typeof environment[varName]) {
            case 'object':
            case 'number':
            case 'boolean':
                environment[varName] = JSON.stringify(environment[varName]);
                break;
            default:
            }
        });
    });

    return jobs;
}

/**
 * Converts the simplified steps into the most-verbose format
 *
 * This is because the user can provide either:
 *  - "command to execute"
 *  - { name: command }
 *
 * The launcher expects it in a consistent format:
 *  - { name: "name", command: "command" }
 * @method convertSteps
 * @param  {Object}       jobs   Object with all the jobs
 * @return {Object}              New object with jobs after up-converting
 */
function convertSteps(jobs) {
    const newJobs = jobs;

    Object.keys(newJobs).forEach((jobName) => {
        const steps = clone(Hoek.reach(newJobs, `${jobName}.steps`, {
            default: []
        }));

        newJobs[jobName].commands = steps.map((step, index) => {
            let name;
            let command;
            let alwaysRun = false;

            switch (typeof step) {
            case 'object':
                if (Object.keys(step).length === 1) {
                    name = Object.keys(step).pop();
                    command = step[name];
                    break;
                } else {
                    name = step.name;
                    command = step.command;
                    alwaysRun = step.alwaysRun || false;
                    break;
                }

            case 'string':
                name = `step-${index + 1}`;
                command = step;
                break;

            default:
            }

            return { name, command, alwaysRun };
        });
    });

    return newJobs;
}

/**
 * Flatten Phase
 *
 * This is where we compress the complexity of the yaml into a format closer to the desired output
 * so that it is easier to validate and iterate on.
 *  - Merges shared into jobs
 *  - Merges templates into jobs
 *  - Converts complex environment definitions into JSON strings
 * @method
 * @param   {Object}   parsedDoc Document that went through structural parsing
 * @returns {Promise}
 */
module.exports = (parsedDoc, templateFactory) => {
    const doc = parsedDoc;

    doc.jobs = flattenSharedIntoJobs(parsedDoc.shared, parsedDoc.jobs); // Flatten shared into jobs
    delete doc.shared;

    return flattenTemplates(doc.jobs, templateFactory)    // Flatten templates
        .then(cleanComplexEnvironment)                    // Clean through the job values
        .then(convertSteps)                               // Convert steps into proper expanded output
        .then((jobs) => {                                 // Append flattened jobs and return flattened doc
            doc.jobs = jobs;

            return doc;
        });
};
