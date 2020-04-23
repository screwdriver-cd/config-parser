'use strict';

const Hoek = require('hoek');
const clone = require('clone');

/**
 * Check if a job has duplicate steps
 * @method checkAdditionalRules
 * @param  {Object}             doc Document that went through structural parsing
 * @return {Array}                  List of errors or null if no error
 */
function checkAdditionalRules(doc) {
    const errors = [];

    Object.keys(doc.jobs).forEach((job) => {
        const { steps } = doc.jobs[job];
        const stepList = [];

        if (steps) {
            for (let i = 0; i < steps.length; i += 1) {
                const stepName = Object.keys(steps[i])[0];

                if ((typeof (steps[i]) === 'object') && (stepList.includes(stepName))) {
                    errors.push(`Job ${job} has duplicate step: ${stepName}`);
                }

                stepList.push(stepName);
            }
        }
    });

    return errors.length === 0 ? null : errors;
}

/**
 * Flatten cache settings to each job
 * @method flattenCacheSettings
 * @param  {Object}             cacheConfig top-level cache settings
 * @param  {Object}             jobs       jobs from screwdriver yaml
 * @return {Object}                         new jobs with cache config flattened
 */
function flattenCacheSettings(cacheConfig, jobs) {
    const cache = {
        pipeline: Hoek.reach(cacheConfig, 'pipeline', { default: [] }),
        event: Hoek.reach(cacheConfig, 'event', { default: [] })
    };

    Object.keys(jobs).forEach((jobName) => {
        if (jobs[jobName].cache !== false) {
            jobs[jobName].cache = Hoek.applyToDefaults(cache,
                { job: Hoek.reach(cacheConfig, `job.${jobName}`, { default: [] }) });
        } else {
            delete jobs[jobName].cache;
        }
    });

    return jobs;
}

/**
 * Merge oldJob into newJob
 * "oldJob" takes precedence over "newJob". For ex: individual job settings vs shared settings
 * @param  {Object}   newJob        Job to be merged into. For ex: shared settings
 * @param  {Object}   oldJob        Job to merge. For ex: individual job settings
 * @param  {Boolean}  fromTemplate  Whether this is merged from template. If true, perform extra actions such as wrapping.
 */
function merge(newJob, oldJob, fromTemplate) {
    // Intialize new job with default fields (environment, settings, and secrets)
    newJob.annotations = newJob.annotations || {};
    newJob.environment = newJob.environment || {};
    newJob.settings = newJob.settings || {};

    // Merge
    Object.assign(newJob.annotations, oldJob.annotations || {});
    Object.assign(newJob.environment, oldJob.environment || {});
    Object.assign(newJob.settings, oldJob.settings || {});
    newJob.image = oldJob.image || newJob.image;

    if (oldJob.requires) {
        newJob.requires = [].concat(oldJob.requires);
    } // otherwise, keep it the same, or don't set if it wasn't set

    if (oldJob.blockedBy) {
        newJob.blockedBy = [].concat(oldJob.blockedBy);
    }

    if (oldJob.freezeWindows) {
        newJob.freezeWindows = [].concat(oldJob.freezeWindows);
    }

    if (oldJob.cache || oldJob.cache === false) {
        newJob.cache = oldJob.cache;
    }

    // Merge secrets
    const newSecrets = newJob.secrets || [];
    const oldSecrets = oldJob.secrets || [];

    // Merge sourcePaths
    let newsourcePaths = newJob.sourcePaths || [];
    let oldsourcePaths = oldJob.sourcePaths || [];

    newsourcePaths = Array.isArray(newsourcePaths) ? newsourcePaths : [newsourcePaths];
    oldsourcePaths = Array.isArray(oldsourcePaths) ? oldsourcePaths : [oldsourcePaths];

    // remove duplicate
    newJob.secrets = [...new Set([...newSecrets, ...oldSecrets])];
    newJob.sourcePaths = [...new Set([...newsourcePaths, ...oldsourcePaths])];

    if (fromTemplate && oldJob.steps) {
        let stepName;
        let preStepName;
        let postStepName;
        const mergedSteps = [];
        const teardownSteps = [];

        // convert steps from oldJob from array to object for faster lookup
        const oldSteps = oldJob.steps.reduce((obj, item) => {
            const key = Object.keys(item)[0];

            if (key.startsWith('teardown-')) {
                teardownSteps.push(key);
            }

            obj[key] = item[key];

            return obj;
        }, {});

        for (let i = 0; i < newJob.steps.length; i += 1) {
            [stepName] = Object.keys(newJob.steps[i]);
            preStepName = `pre${stepName}`;
            postStepName = `post${stepName}`;

            // add pre-step
            if (oldSteps[preStepName]) {
                mergedSteps.push({ [preStepName]: oldSteps[preStepName] });
            }

            // if user doesn't define the same step, add it
            if (!oldSteps[stepName]) {
                mergedSteps.push(newJob.steps[i]);
            } else if (!stepName.startsWith('teardown-')) {
                // if user defines the same step, only add if it's not teardown
                // otherwise, skip (it will be overriden later, otherwise will get duplicate steps)
                mergedSteps.push({ [stepName]: oldSteps[stepName] });
            }

            // add post-step
            if (oldSteps[postStepName]) {
                mergedSteps.push({ [postStepName]: oldSteps[postStepName] });
            }
        }

        for (let i = 0; i < teardownSteps.length; i += 1) {
            stepName = teardownSteps[i];
            mergedSteps.push({ [stepName]: oldSteps[stepName] });
        }

        newJob.steps = mergedSteps;
    }
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
        ['image', 'matrix', 'steps', 'template', 'description', 'cache'].forEach((key) => {
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
    const oldJob = jobConfig;

    // Try to get the template
    return templateFactory.getTemplate(jobConfig.template)
        .then((template) => {
            if (!template) {
                throw new Error(`Template ${jobConfig.template} does not exist`);
            }

            const newJob = template.config;
            const environment = newJob.environment || {};

            // Construct full template name
            let fullName = template.name;

            if (template.namespace && template.namespace !== 'default') {
                fullName = `${template.namespace}/${template.name}`;
            }

            // Inject template full name, name, namespace, and version to env
            newJob.environment = Hoek.merge(environment, {
                SD_TEMPLATE_FULLNAME: fullName,
                SD_TEMPLATE_NAME: template.name,
                SD_TEMPLATE_NAMESPACE: template.namespace || '',
                SD_TEMPLATE_VERSION: template.version
            });

            merge(newJob, oldJob, true);
            delete newJob.template;

            newJob.templateId = template.id;

            // If template.images contains a label match for the image defined in the job
            // set the job image to the respective template image
            if (typeof template.images !== 'undefined'
                && typeof template.images[newJob.image] !== 'undefined') {
                newJob.image = template.images[newJob.image];
            }

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
            newJobs[jobName] = jobConfig; // Otherwise just use jobConfig
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

            switch (typeof step) {
            case 'object':
                name = Object.keys(step).pop();
                command = step[name];
                break;

            case 'string':
                name = `step-${index + 1}`;
                command = step;
                break;

            default:
            }

            return { name, command };
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

    // Flatten shared into jobs
    doc.jobs = flattenSharedIntoJobs(parsedDoc.shared, parsedDoc.jobs);
    delete doc.shared;

    if (parsedDoc.cache) {
        doc.jobs = flattenCacheSettings(parsedDoc.cache, doc.jobs);
        delete doc.cache;
    }

    // Flatten templates
    return flattenTemplates(doc.jobs, templateFactory)
        // Clean through the job values
        .then(cleanComplexEnvironment)
        // Convert steps into proper expanded output
        .then(convertSteps)
        // Append flattened jobs and return flattened doc
        .then((jobs) => {
            doc.jobs = jobs;

            const errors = checkAdditionalRules(doc);

            if (errors) {
                throw new Error(errors.toString());
            }

            return doc;
        });
};
