'use strict';

const Hoek = require('@hapi/hoek');
const clone = require('clone');
const { STAGE_TRIGGER } = require('screwdriver-data-schema/config/regex');

const STAGE_PREFIX = 'stage@';
const STAGE_SETUP_TEARDOWN_PATTERN = /stage@[\w-]+:(?:setup|teardown)$/;
const DEFAULT_JOB = {
    image: 'node:18',
    steps: [{ noop: 'echo noop' }],
    annotations: { 'screwdriver.cd/virtualJob': true }
};

/**
 * Check if a job has duplicate steps
 * @method checkAdditionalRules
 * @param  {Object}             doc Document that went through structural parsing
 * @return {Array}                  List of errors or null if no error
 */
function checkAdditionalRules(doc) {
    const errors = [];

    Object.keys(doc.jobs).forEach(job => {
        const { commands } = doc.jobs[job];
        const stepList = [];

        if (commands) {
            for (let i = 0; i < commands.length; i += 1) {
                const stepName = Object.values(commands[i])[0];

                if (typeof commands[i] === 'object' && stepList.includes(stepName)) {
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

    Object.keys(jobs).forEach(jobName => {
        if (jobs[jobName].cache !== false) {
            jobs[jobName].cache = Hoek.applyToDefaults(cache, {
                job: Hoek.reach(cacheConfig, `job.${jobName}`, { default: [] })
            });
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
    // Initialize new job with default fields (environment, settings, and secrets)
    newJob.annotations = newJob.annotations || {};
    newJob.environment = newJob.environment || {};
    newJob.settings = newJob.settings || {};

    // Merge
    Object.assign(newJob.annotations, oldJob.annotations || {});
    Object.assign(newJob.environment, oldJob.environment || {});
    Object.assign(newJob.settings, oldJob.settings || {});
    newJob.image = oldJob.image || newJob.image;

    if (oldJob.description) {
        newJob.description = oldJob.description;
    }

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

    if (oldJob.order) {
        newJob.order = [].concat(oldJob.order);
    }

    if (oldJob.provider) {
        newJob.provider = oldJob.provider || {};
    }

    if (oldJob.stage) {
        newJob.stage = oldJob.stage || {};
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

    let warnings = [];
    let newSteps = [];
    let oldSteps = [];
    const mergedSteps = [];
    const lockedStepNames = [];
    const teardownSteps = [];

    if (Hoek.reach(newJob, 'steps')) {
        newSteps = newJob.steps.reduce((obj, item) => {
            const key = Object.keys(item)[0];
            const substepKeys = typeof item[key] === 'object' ? Object.keys(item[key]) : undefined;

            // Compress step if only has command key
            if (substepKeys && substepKeys.length === 1) {
                obj[key] = item[key].command;
            } else {
                if (substepKeys && substepKeys.includes('locked')) {
                    lockedStepNames.push(key);
                }
                obj[key] = item[key];
            }

            return obj;
        }, {});
    }
    if (Hoek.reach(oldJob, 'steps')) {
        // convert steps from oldJob from array to object for faster lookup
        oldSteps = oldJob.steps.reduce((obj, item) => {
            const key = Object.keys(item)[0];
            const substepKeys = typeof item[key] === 'object' ? Object.keys(item[key]) : undefined;

            if (!oldJob.order && key.startsWith('teardown-')) {
                teardownSteps.push(key);
            }

            // Compress step if only has command key
            if (substepKeys && substepKeys.length === 1) {
                obj[key] = item[key].command;
            } else {
                obj[key] = item[key];
            }

            return obj;
        }, {});
    }

    // Use "order" to get steps, ignore all other steps;
    // current template has precedence over external template
    if (fromTemplate && oldJob.order) {
        let stepName;

        // Order must contain locked steps
        const orderContainsLockedSteps = lockedStepNames.every(v => oldJob.order.includes(v));

        if (!orderContainsLockedSteps) {
            // eslint-disable-next-line max-len
            throw new Error(`Order must contain template ${oldJob.template} locked steps: ${lockedStepNames}`);
        }

        for (let i = 0; i < oldJob.order.length; i += 1) {
            let step;

            stepName = oldJob.order[i];

            const stepLocked = Hoek.reach(newSteps[stepName], 'locked');

            if (!stepLocked && Hoek.reach(oldSteps, stepName)) {
                step = { [stepName]: oldSteps[stepName] };
            } else if (stepLocked || Hoek.reach(newSteps, stepName)) {
                step = { [stepName]: newSteps[stepName] };
                if (stepLocked && Hoek.reach(oldSteps, stepName)) {
                    // eslint-disable-next-line max-len
                    warnings = warnings.concat(
                        `Cannot override locked step ${stepName}; using step definition from template ${oldJob.template}`
                    );
                }
            } else {
                warnings = warnings.concat(`${stepName} step definition not found; skipping`);
            }

            if (step) {
                if (stepName.startsWith('teardown-')) {
                    teardownSteps.push(step);
                } else {
                    mergedSteps.push(step);
                }
            }
        }

        newJob.steps = mergedSteps.concat(teardownSteps);
        // Basic step merge with template
    } else if (fromTemplate && oldJob.steps) {
        let stepName;
        let preStepName;
        let postStepName;

        for (let i = 0; i < newJob.steps.length; i += 1) {
            [stepName] = Object.keys(newJob.steps[i]);
            preStepName = `pre${stepName}`;
            postStepName = `post${stepName}`;

            // add pre-step
            if (oldSteps[preStepName]) {
                mergedSteps.push({ [preStepName]: oldSteps[preStepName] });
            }

            const stepLocked = Hoek.reach(newJob.steps[i][stepName], 'locked');

            // If template step is locked or user doesn't define the same step, add it
            if (stepLocked || !oldSteps[stepName]) {
                mergedSteps.push(newJob.steps[i]);
                if (stepLocked && oldSteps[stepName]) {
                    // eslint-disable-next-line max-len
                    warnings = warnings.concat(
                        `Cannot override locked step ${stepName}; using step definition from template ${oldJob.template}`
                    );
                }
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

    return warnings;
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

    Object.keys(jobs).forEach(jobName => {
        const newJob = clone(shared);
        const oldJob = clone(jobs[jobName]);

        // Replace
        ['image', 'matrix', 'steps', 'template', 'description', 'cache', 'parameters', 'provider'].forEach(key => {
            if (oldJob[key]) {
                newJob[key] = oldJob[key];
            }
        });

        // Replace settings if empty object
        if (Hoek.deepEqual(oldJob.settings, {})) {
            newJob.settings = oldJob.settings;
        }

        merge(newJob, oldJob);
        newJobs[jobName] = newJob;
    });

    return newJobs;
}

/**
 * Retrieve template and merge into job config
 *
 * @method mergeTemplateIntoJob
 * @param  {String}           jobName               Job name
 * @param  {Object}           jobConfig             Job config
 * @param  {Object}           newJobs               Object with all the jobs
 * @param  {TemplateFactory}  templateFactory       Template Factory to get templates
 * @param  {Object}           sharedConfig          Shared configuration
 * @param  {Object}           pipelineParameters    Pipeline level parameters
 * @return {Promise}
 */
function mergeTemplateIntoJob({ jobName, jobConfig, newJobs, templateFactory, sharedConfig, pipelineParameters }) {
    const oldJob = jobConfig;

    // Try to get the template
    return templateFactory.getTemplate(jobConfig.template).then(template => {
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

        let warnings = [];

        // merge shared steps into oldJob
        if (
            sharedConfig.steps &&
            ((oldJob.annotations && oldJob.annotations['screwdriver.cd/mergeSharedSteps']) ||
                ((oldJob.annotations === undefined ||
                    oldJob.annotations['screwdriver.cd/mergeSharedSteps'] === undefined) &&
                    template.annotations &&
                    template.annotations['screwdriver.cd/mergeSharedSteps']))
        ) {
            // convert steps from oldJob from array to object for faster lookup
            const oldSteps = oldJob.steps.reduce((obj, item) => {
                const key = Object.keys(item)[0];

                obj[key] = item[key];

                return obj;
            }, {});

            for (let i = 0; i < sharedConfig.steps.length; i += 1) {
                if (!oldSteps[Object.keys(sharedConfig.steps[i])]) {
                    oldJob.steps.push(sharedConfig.steps[i]);
                }
            }
        }

        // Include parameters from the template only if it not overwritten either in pipeline or job parameters
        if (newJob.parameters !== undefined) {
            const mergedJobParameters = oldJob.parameters || {};
            const mergedJobParameterNames = Object.keys(mergedJobParameters);
            const pipelineParameterNames = Object.keys(pipelineParameters || {});

            for (const [key, value] of Object.entries(newJob.parameters)) {
                if (!mergedJobParameterNames.includes(key) && !pipelineParameterNames.includes(key)) {
                    mergedJobParameters[key] = value;
                }
            }

            if (Object.keys(mergedJobParameters).length > 0) {
                newJob.parameters = mergedJobParameters;
            } else {
                delete newJob.parameters;
            }
        } else {
            newJob.parameters = oldJob.parameters;
        }

        warnings = merge(newJob, oldJob, true);

        delete newJob.template;

        newJob.templateId = template.id;

        // If template.images contains a label match for the image defined in the job
        // set the job image to the respective template image
        if (typeof template.images !== 'undefined' && typeof template.images[newJob.image] !== 'undefined') {
            newJob.image = template.images[newJob.image];
        }

        newJobs[jobName] = newJob;

        return warnings;
    });
}

/**
 * Goes through each job and if template is specified, then merge into job config
 *
 * @method flattenTemplates
 * @param  {Object}           doc               Document that went through structural parsing
 * @param  {TemplateFactory}  templateFactory   Template Factory to get templates
 * @return {Promise}          Resolves to new object with jobs after merging templates
 */
function flattenTemplates(doc, templateFactory) {
    const newJobs = {};
    const templates = [];
    const { jobs, shared, parameters } = doc;

    Object.keys(jobs).forEach(jobName => {
        const jobConfig = clone(jobs[jobName]);
        const templateConfig = jobConfig.template;
        const order = jobConfig.order || [];
        let warnMessages = [];

        // Validate order is used with template
        if (order.length > 0 && templateConfig === undefined) {
            warnMessages = warnMessages.concat(`"order" in ${jobName} job cannot be used without "template"`);

            templates.push(warnMessages);
        }

        // If template is specified, then merge
        if (templateConfig) {
            templates.push(
                mergeTemplateIntoJob({
                    jobName,
                    jobConfig,
                    newJobs,
                    templateFactory,
                    sharedConfig: shared,
                    pipelineParameters: parameters
                })
            );
        } else {
            newJobs[jobName] = jobConfig; // Otherwise just use jobConfig
        }
    });

    // Wait until all promises are resolved
    return Promise.all(templates).then(warnings => ({ warnings: [].concat(...warnings), newJobs }));
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
    Object.keys(jobs).forEach(jobName => {
        const environment = Hoek.reach(jobs, `${jobName}.environment`, {
            default: {}
        });

        Object.keys(environment).forEach(varName => {
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
 *  - { "name": "command" }
 *  - { "name": { "command": "somecommand", "otherkey": "value" }}
 *
 * The launcher expects it in a consistent format:
 *  - { "name": "name", "command": "command", "otherkey": "value" }
 * @method convertSteps
 * @param  {Object}       jobs   Object with all the jobs
 * @return {Object}              New object with jobs after up-converting
 */
function convertSteps(jobs) {
    const newJobs = jobs;

    Object.keys(newJobs).forEach(jobName => {
        const steps = clone(
            Hoek.reach(newJobs, `${jobName}.steps`, {
                default: []
            })
        );

        newJobs[jobName].commands = steps.map((step, index) => {
            let name;
            let command;
            let locked;

            switch (typeof step) {
                case 'object':
                    name = Object.keys(step).pop();
                    command = step[name].command || step[name];
                    ({ locked } = step[name]);
                    break;

                case 'string':
                    name = `step-${index + 1}`;
                    command = step;
                    break;

                default:
            }

            if (locked) {
                return { name, command, locked };
            }

            return { name, command };
        });
    });

    return newJobs;
}

/**
 * Get full stage name
 * @param  {String} stageName               Stage name
 * @param  {String} type                    Type of stage job (setup or teardown)
 * @return {String}                         Full stage job name (e.g. stage@deploy:setup)
 */
function getFullStageJobName({ stageName, type }) {
    return `${STAGE_PREFIX}${stageName}:${type}`;
}

/**
 * Get stage teardown requires nodes
 * @param  {Object} jobs            Jobs
 * @param  {String} stageName       Stage name
 * @return {Array}                  Teardown requires
 */
function getTeardownRequires(jobs, stageName) {
    let stageJobsRequires = [];
    const stageJobNames = [];

    // Find jobs that belong to the stage
    // Get requires for jobs that belong to the stage
    Object.keys(jobs).forEach(jobName => {
        if (
            jobs[jobName].stage &&
            jobs[jobName].stage.name === stageName &&
            !STAGE_SETUP_TEARDOWN_PATTERN.test(jobName)
        ) {
            if (Array.isArray(jobs[jobName].requires)) {
                stageJobsRequires = stageJobsRequires.concat(jobs[jobName].requires);
            } else {
                stageJobsRequires.push(jobs[jobName].requires);
            }
            stageJobNames.push(jobName);
        }
    });

    // Get terminal nodes
    return stageJobNames.filter(
        jobName => !stageJobsRequires.includes(jobName) && !stageJobsRequires.includes(`~${jobName}`)
    );
}

/**
 * Expands stage triggers specified in 'job.requires' or 'stage.requires' to stage teardown job triggers
 * Examples:
 * [stage@canary, ~stage:performance, A, B, ~C] -> [stage@canary:teardown, ~stage:performance:teardown, A, B, ~C]
 * stage@canary -> stage@canary:teardown
 * [] -> []
 *
 * @param  {Object} stageOrJob               Job
 */
function convertStageTriggerToTeardownTrigger(stageOrJob) {
    if (stageOrJob.requires) {
        const converterFn = trigger => {
            const result = trigger.match(STAGE_TRIGGER);

            if (result && !result[2]) {
                return `${trigger}:teardown`;
            }

            return trigger;
        };

        if (Array.isArray(stageOrJob.requires)) {
            stageOrJob.requires = stageOrJob.requires.map(converterFn);
        } else {
            stageOrJob.requires = converterFn(stageOrJob.requires);
        }
    }
}

/**
 * Flatten stage setup and teardown into jobs object
 * @param  {Object} doc               Document that went through structural parsing
 */
function flattenStageSetupAndTeardownJobs(doc) {
    const newJobs = clone(doc.jobs);
    const stages = clone(doc.stages);

    if (stages) {
        Object.entries(stages).forEach(([stageName, stage]) => {
            const { setup, teardown, jobs: stageJobNames } = stages[stageName];
            let stageSetup = setup;
            let stageTeardown = teardown;

            Object.entries(newJobs).forEach(([jobName, job]) => {
                if (stageJobNames.includes(jobName)) {
                    job.stage = { name: stageName };

                    if (!job.requires || job.requires.length === 0) {
                        job.requires = `~${getFullStageJobName({ stageName, type: 'setup' })}`;
                    }
                } else {
                    convertStageTriggerToTeardownTrigger(job);
                }
            });

            convertStageTriggerToTeardownTrigger(stage);

            const setupStageName = getFullStageJobName({ stageName, type: 'setup' });
            const teardownStageName = getFullStageJobName({ stageName, type: 'teardown' });

            // Implicitly create setup/teardown
            if (Hoek.deepEqual(stageSetup, {})) {
                stageSetup = DEFAULT_JOB;
            }
            if (Hoek.deepEqual(stageTeardown, {})) {
                stageTeardown = DEFAULT_JOB;
            }

            newJobs[setupStageName] = {
                ...stageSetup,
                ...{ requires: stages[stageName].requires || [], stage: { name: stageName } }
            };
            newJobs[teardownStageName] = {
                ...stageTeardown,
                ...{ requires: getTeardownRequires(newJobs, stageName), stage: { name: stageName } }
            };

            delete stages[stageName].teardown;
            delete stages[stageName].setup;
        });
    }

    return { jobs: newJobs, stages };
}

/**
 * Flatten Phase
 *
 * This is where we compress the complexity of the yaml into a format closer to the desired output
 * so that it is easier to validate and iterate on.
 *  - Merges shared into jobs
 *  - Merges templates into jobs
 *  - Converts complex environment definitions into JSON strings
 * @method  flattenPhase
 * @param   {Object}           parsedDoc             Document that went through structural parsing
 * @param   {TemplateFactory}  templateFactory       Template Factory to get templates
 * @returns {Promise}
 */
function flattenPhase(parsedDoc, templateFactory) {
    const doc = parsedDoc;

    // Flatten stage setup and teardown into jobs
    const { jobs, stages } = flattenStageSetupAndTeardownJobs(parsedDoc);

    doc.jobs = jobs;

    if (stages) {
        doc.stages = stages;
    }

    // Flatten shared into jobs
    doc.jobs = flattenSharedIntoJobs(parsedDoc.shared, parsedDoc.jobs);

    if (parsedDoc.cache) {
        doc.jobs = flattenCacheSettings(parsedDoc.cache, doc.jobs);
        delete doc.cache;
    } else {
        Object.keys(doc.jobs).forEach(jobName => {
            if (doc.jobs[jobName].cache !== undefined) {
                throw new Error('Cache disable/enable is set without the cache setting itself.');
            }
        });
    }

    // Flatten templates
    return flattenTemplates(doc, templateFactory).then(({ warnings, newJobs }) => {
        // Clean through the job values
        const cleanedJobs = cleanComplexEnvironment(newJobs);
        // Convert steps into proper expanded output
        const convertedJobs = convertSteps(cleanedJobs);

        // Append flattened jobs and return flattened doc
        doc.jobs = convertedJobs;
        delete doc.shared;

        const errors = checkAdditionalRules(doc);

        if (errors) {
            throw new Error(errors.toString());
        }

        return { warnings, flattenedDoc: doc };
    });
}

module.exports = {
    flattenPhase,
    flattenSharedIntoJobs
};
