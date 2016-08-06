'use strict';

const Hoek = require('hoek');
const clone = require('clone');

/**
 * Overlays the stuff specified in a specific job on top of the defaults in shared
 *
 * @method flattenSharedIntoJobs
 * @param  {Job}          shared A kind of default Job template
 * @param  {Object}       jobs   List of jobs (name => job)
 * @return {Object}              Updated list of jobs after merging
 */
function flattenSharedIntoJobs(shared, jobs) {
    const newJobs = {};

    Object.keys(jobs).forEach((jobName) => {
        const newJob = clone(shared);
        const oldJob = clone(jobs[jobName]);

        ['image', 'matrix', 'steps'].forEach((key) => {
            if (oldJob[key]) {
                newJob[key] = oldJob[key];
            }
        });

        if (!newJob.environment) {
            newJob.environment = {};
        }

        Object.assign(newJob.environment, oldJob.environment || {});

        newJobs[jobName] = newJob;
    });

    return newJobs;
}

/**
 * Converts complex environment variables like objects or arrays into JSON-ified strings
 *
 * This is because YAML allows you to define complex structures easily, but our input to the shell
 * is just simple strings (environment variables).
 * @method cleanComplexEnvironment
 * @param  {Object}       jobs   List of jobs (name => job)
 * @return {Object}              Updated list of jobs after cleaning
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
 * Flatten Phase
 *
 * This is where we compress the complexity of the yaml into a format closer to the desired output
 * so that it is easier to validate and iterate on.
 *  - Merges shared into jobs
 *  - Converts complex environment definitions into JSON strings
 * @method
 * @param  {Object}   parsedDoc Document that went through structural parsing
 * @param  {Function} callback  Function to call when done (err, doc)
 */
module.exports = (parsedDoc, callback) => {
    const doc = parsedDoc;

    // Shared
    // Flatten shared into jobs
    doc.jobs = flattenSharedIntoJobs(parsedDoc.shared, parsedDoc.jobs);
    delete doc.shared;

    // Environment
    // Clean through the job values
    doc.jobs = cleanComplexEnvironment(doc.jobs);

    callback(null, doc);
};
