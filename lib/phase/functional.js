'use strict';

const Joi = require('joi');
const Hoek = require('@hapi/hoek');
const clone = require('clone');
const WorkflowParser = require('screwdriver-workflow-parser');
const SlackValidation = require('screwdriver-notifications-slack');
const EmailValidation = require('screwdriver-notifications-email');
const YamlParser = require('js-yaml');

// Actual environment size is limited by space, not quantity.
// We do this to force sd.yaml to be simpler.
const MAX_ENVIRONMENT_VARS = 100;
// If they are trying to execute >25 permutations,
// maybe there is a better way to accomplish their goal.
const MAX_PERMUTATIONS = 25;
// Env that is created by Screwdriver instead of user
const SDEnv = [
    'SD_TEMPLATE_FULLNAME',
    'SD_TEMPLATE_NAME',
    'SD_TEMPLATE_NAMESPACE',
    'SD_TEMPLATE_VERSION',
    'SD_PIPELINE_TEMPLATE_FULLNAME',
    'SD_PIPELINE_TEMPLATE_NAME',
    'SD_PIPELINE_TEMPLATE_NAMESPACE',
    'SD_PIPELINE_TEMPLATE_VERSION'
];

/**
 * Ensure notifications plugin is valid
 * @method validateNotificationSetting
 * @param  {Object}   config
 * @param  {Object}   config.doc                        Document that went through flattening
 * @param  {Boolean}  config.notificationsValidationErr Throw error when notifications validation fails
 * @return {Object}   Array of errors, array of warnings
 */
function validateNotificationSetting({ doc, notificationsValidationErr }) {
    const errors = [];
    const warnings = [];

    Object.keys(doc.jobs).forEach(job => {
        let error;
        const { settings } = doc.jobs[job];

        if (settings && 'slack' in settings) {
            error = SlackValidation.validateConfig(settings);
            if (error.error && notificationsValidationErr) {
                errors.push(`${job} ${error.error.message}`);
            } else if (error.error) {
                warnings.push(`${job} ${error.error.message}; skipping`);
                delete doc.jobs[job].settings.slack;
            }
        }
        if (settings && 'email' in settings) {
            error = EmailValidation.validateConfig(settings);
            if (error.error && notificationsValidationErr) {
                errors.push(`${job} ${error.error.message}`);
            } else if (error.error) {
                warnings.push(`${job} ${error.error.message}; skipping`);
                delete doc.jobs[job].settings.email;
            }
        }
    });

    return { errMessages: errors, warnMessages: warnings };
}

/**
 * Ensure the build cluster annotation is valid
 * @method validateBuildClusterAnnotation
 * @param  {BuildClusterFactory}  buildClusterFactory Build cluster Factory to get build clusters
 * @param  {Object}               doc Document that went through flattening
 * @return {Array}                List of errors
 */
function validateBuildClusterAnnotation(doc, buildClusterFactory) {
    const buildClusterAnnotation = 'screwdriver.cd/buildCluster';
    const buildClusterName = Hoek.reach(doc, `annotations>${buildClusterAnnotation}`, { separator: '>' });

    if (buildClusterName && buildClusterFactory) {
        return buildClusterFactory
            .list()
            .then(buildClusters => buildClusters.some(cluster => cluster.name === buildClusterName))
            .then(hasValidBuildCluster => {
                if (!hasValidBuildCluster) {
                    return [`Annotation "${buildClusterAnnotation}": ${buildClusterName} is not a valid build cluster`];
                }

                return [];
            });
    }

    return Promise.resolve([]);
}

/**
 * Ensure the triggers for a job are valid
 * @method isJobTriggersValid
 * @param  {Array}  triggers    List of requires configured for a job
 * @param  {Array}  options     List of valid options to trigger a job
 * @return {Boolean}
 *
 */
function isJobTriggersValid(triggers, options) {
    // it is valid if triggers is not defined or empty
    if (!triggers || triggers.length === 0) {
        return true;
    }

    // remove tilde from triggers
    const noTildeTriggers = triggers.map(item => item.replace(/^~/, ''));

    return noTildeTriggers.every(item => options.includes(item));
}

/**
 * Make sure the Matrix they specified is valid
 * @method validateJobMatrix
 * @param  {Object}      job     Job to inspect
 * @param  {String}      prefix  Prefix before reporting errors
 * @return {Array}               List of errors
 */
function validateJobMatrix(job, prefix) {
    let matrixSize = 1;
    const errors = [];
    const matrix = Hoek.reach(job, 'matrix', {
        default: {}
    });
    const environment = Hoek.reach(job, 'environment', {
        default: {}
    });
    const userEnv = Object.keys(environment).filter(key => !SDEnv.includes(key));
    const environmentSize = Object.keys(matrix).length + userEnv.length;

    if (environmentSize > MAX_ENVIRONMENT_VARS) {
        errors.push(
            `${prefix}: "environment" and "matrix" can only have a combined ` +
                ` maxiumum of ${MAX_ENVIRONMENT_VARS} environment variables defined ` +
                `(currently ${environmentSize})`
        );
    }

    Object.keys(matrix).forEach(row => {
        matrixSize *= matrix[row].length;
    });

    if (matrixSize > MAX_PERMUTATIONS) {
        errors.push(`${prefix}: "matrix" cannot contain >${MAX_PERMUTATIONS} permutations (currently ${matrixSize})`);
    }

    return errors;
}

/**
 * Make sure the Steps are possible
 *  - Check it doesn't start with sd-
 * @method validateJobSteps
 * @param  {Object}      job     Job to inspect
 * @param  {String}      prefix  Prefix before reporting errors
 * @return {Array}               List of errors
 */
function validateJobSteps(job, prefix) {
    const errors = [];
    const steps = Hoek.reach(job, 'commands', {
        default: []
    });

    steps.forEach(step => {
        if (step.name.toLowerCase().indexOf('sd-') === 0) {
            errors.push(`${prefix}: Step "${step.name}": cannot use a restricted prefix "sd-"`);
        }
    });

    return errors;
}

/**
 * Ensure the job is something that can be run
 *  - has at least one step
 *  - the image name
 *  - not too many environment variables
 * @method validateJobSchema
 * @param  {Object}          doc Document that went through flattening
 * @return {Array}               List of errors
 */
function validateJobSchema(doc) {
    let errors = [];

    // Jobs
    const SCHEMA_JOB = Joi.object()
        .keys({
            commands: Joi.array().min(1).required(),
            image: Joi.string().required(),
            environment: Joi.object().default({})
        })
        .unknown(true)
        // Add documentation
        .description('requires at least one step');

    // Validate jobs contain required minimum fields
    Object.keys(doc.jobs).forEach(jobName => {
        const prefix = `Job "${jobName}"`;

        try {
            Joi.attempt(doc.jobs[jobName], SCHEMA_JOB, prefix);
        } catch (err) {
            errors.push(err.message);
        }

        const environment = Hoek.reach(doc.jobs[jobName], 'environment', {
            default: {}
        });
        const userEnv = Object.keys(environment).filter(key => !SDEnv.includes(key));

        if (userEnv.length > MAX_ENVIRONMENT_VARS) {
            // eslint-disable-next-line max-len
            errors.push(`"environment" can only have ${MAX_ENVIRONMENT_VARS} environment variables defined`);
        }

        // Check special prefixes
        if (jobName.toLowerCase().indexOf('pr-') === 0) {
            errors.push(`${prefix}: cannot use a restricted prefix "pr-"`);
        }

        errors = errors.concat(validateJobMatrix(doc.jobs[jobName], prefix));
        errors = errors.concat(validateJobSteps(doc.jobs[jobName], prefix));
    });

    return errors;
}

/**
 * Get the defined workflowGraph, or if missing generate one (list of all jobs in series)
 * @method generateWorkflowGraph
 * @param  {Object}          doc            Document that went through flattening
 * @param  {TriggerFactory}  triggerFactory Trigger Factory to find external triggers
 * @param  {Number}          pipelineId     Id of the current pipeline
 * @return {Object}          WorkflowGraph that consists of nodes and edges
 */
async function generateWorkflowGraph(doc, triggerFactory, pipelineId) {
    // In case doc got changed during workflowGraph parsing
    const cloneDoc = clone(doc);

    return WorkflowParser.getWorkflow(cloneDoc, triggerFactory, pipelineId);
}

/**
 * Ensure the workflowGraph is a valid one
 *  - No cycles in workflowGraph
 * @method validateWorkflowGraph
 * @param  {Object}          doc Document that went through flattening
 * @return {Array}               List of errors
 */
function validateWorkflowGraph(doc) {
    if (WorkflowParser.hasCycle(doc.workflowGraph)) {
        return ['Jobs: should not have circular dependency in jobs'];
    }

    return [];
}

/**
 * Check there are no duplicate jobs in stages and all jobs listed exist
 * @method verifyStages
 * @param  {Object} stages Stages
 * @param  {Object} jobs   Jobs
 */
function verifyStages(stages, jobs) {
    if (!stages) {
        return;
    }

    // Get list of job names in jobs
    const jobNames = Object.keys(jobs);

    // Get list of job names in stages
    let stageJobNames = [];

    Object.values(stages).forEach(stage => {
        stageJobNames = stageJobNames.concat(stage.jobs);
    });

    // If job name is repeated in stages, throw error
    const duplicateJobsInStage = stageJobNames.filter((item, index) => stageJobNames.indexOf(item) !== index);

    if (duplicateJobsInStage.length > 0) {
        throw new YamlParser.YAMLException(`Cannot have duplicate job in multiple stages: ${duplicateJobsInStage}`);
    }

    // If job name does not exist, throw error
    const nonexistentJobsInStage = stageJobNames.filter(jobName => !jobNames.includes(jobName));

    if (nonexistentJobsInStage.length > 0) {
        throw new YamlParser.YAMLException(`Cannot have nonexistent job in stages: ${nonexistentJobsInStage}`);
    }

    Object.keys(stages).forEach(stageName => {
        const jobsInStage = [...stages[stageName].jobs];
        // Check if setup job is not in the list, then add it

        if (!jobsInStage.includes(`stage@${stageName}:setup`)) {
            jobsInStage.push(`stage@${stageName}:setup`);
        }
        stages[stageName].jobs.forEach(jobName => {
            if (!isJobTriggersValid(jobs[jobName].requires, jobsInStage)) {
                throw new YamlParser.YAMLException(
                    `${jobName} job has invalid requires: ${jobs[jobName].requires}, triggers must be in the same stage`
                );
            }
        });
    });
}

/**
 * Functional Phase
 *
 * Now that we have a constant list of jobs, this phase is for validating that the
 * jobs will execute as specified.  This is going to be mostly business logic like
 * too many environment variables.
 * @method
 * @param  {Object}              config
 * @param  {Object}              config.flattenedDoc           Document that went through flattening
 * @param  {BuildClusterFactory} config.buildClusterFactory    Build cluster Factory to get build clusters
 * @param  {TriggerFactory}      [config.triggerFactory]       Trigger Factory to find external triggers
 * @param  {Number}              [config.pipelineId]           ID of the current pipeline
 * @param  {Boolean}             [config.notificationsValidationErr]  Throw error when notification validation fails (default true);
 *                                                                    otherwise return warning
 * @param  {Promise}
 */
module.exports = async ({
    flattenedDoc,
    buildClusterFactory,
    triggerFactory,
    pipelineId,
    notificationsValidationErr
}) => {
    const doc = flattenedDoc;
    let errors = [];
    let warnings = [];

    // Jobs
    errors = errors.concat(validateJobSchema(doc));

    try {
        verifyStages(doc.stages, doc.jobs);
    } catch (error) {
        errors.push(error);
    }

    // Workflow graph
    doc.workflowGraph = await generateWorkflowGraph(doc, triggerFactory, pipelineId);

    doc.workflowGraph.nodes.forEach(node => {
        if (node.name === 'subscribe') node.name = '~subscribe';
    });

    doc.workflowGraph.edges.forEach(edge => {
        if (edge.src === 'subscribe') edge.src = '~subscribe';
    });

    errors = errors.concat(validateWorkflowGraph(doc));

    const { warnMessages, errMessages } = validateNotificationSetting({
        doc,
        notificationsValidationErr
    });

    errors = errors.concat(errMessages);
    warnings = warnings.concat(warnMessages);

    // Check if build cluster annotation is valid
    return validateBuildClusterAnnotation(doc, buildClusterFactory).then(errs => {
        errors = errors.concat(errs);

        if (errors.length > 0) {
            return Promise.reject(new Error(errors.join('\n')));
        }

        return Promise.resolve({ doc, warnings });
    });
};
