'use strict';

const Joi = require('joi');
const Hoek = require('hoek');
const clone = require('clone');
const WorkflowParser = require('screwdriver-workflow-parser');

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
    'SD_TEMPLATE_VERSION'
];

/**
 * Ensure the build cluster annotation is valid
 * @method validateBuildClusterAnnotation
 * @param  {BuildClusterFactory}  buildClusterFactory Build cluster Factory to get build clusters
 * @param  {Object}               doc Document that went through flattening
 * @return {Array}                List of errors
 */
function validateBuildClusterAnnotation(doc, buildClusterFactory) {
    const buildClusterAnnotation = 'screwdriver.cd/buildCluster';
    const buildClusterName = Hoek.reach(doc, 'annotations') ?
        doc.annotations[buildClusterAnnotation] : undefined;

    if (buildClusterName && buildClusterFactory) {
        return buildClusterFactory.list()
            .then(buildClusters => buildClusters.some(buildCluster =>
                buildCluster.name === buildClusterName
            ))
            .then((hasValidBuildCluster) => {
                if (!hasValidBuildCluster) {
                    return [`Annotation "${buildClusterAnnotation}": ` +
                        `${buildClusterName} is not a valid build cluster`];
                }

                return [];
            });
    }

    return Promise.resolve([]);
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
        errors.push(`${prefix}: "environment" and "matrix" can only have a combined ` +
            ` maxiumum of ${MAX_ENVIRONMENT_VARS} environment variables defined ` +
            `(currently ${environmentSize})`);
    }

    Object.keys(matrix).forEach((row) => {
        matrixSize *= matrix[row].length;
    });

    if (matrixSize > MAX_PERMUTATIONS) {
        errors.push(`${prefix}: "matrix" cannot contain >${MAX_PERMUTATIONS} permutations ` +
            `(currently ${matrixSize})`);
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

    steps.forEach((step) => {
        if (step.name.toLowerCase().indexOf('sd-') === 0) {
            errors.push(`${prefix}: Step "${step.name}": `
                + 'cannot use a restricted prefix "sd-"');
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
        .options({
            language: {
                object: {
                    min: 'requires at least one step'
                }
            }
        });

    // Validate jobs contain required minimum fields
    Object.keys(doc.jobs).forEach((jobName) => {
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
 * @param  {Object}          doc Document that went through flattening
 * @return {Object}              WorkflowGraph that consists of nodes and edges
 */
function generateWorkflowGraph(doc) {
    // In case doc got changed during workflowGraph parsing
    const cloneDoc = clone(doc);

    return WorkflowParser.getWorkflow(cloneDoc);
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
 * Functional Phase
 *
 * Now that we have a constant list of jobs, this phase is for validating that the
 * jobs will execute as specified.  This is going to be mostly business logic like
 * too many environment variables.
 * @method
 * @param  {Object}   flattenedDoc Document that went through flattening
 * @param  {Function} callback     Function to call when done (err, doc)
 * @param  {Promise}
 */
module.exports = (flattenedDoc, buildClusterFactory) => (
    new Promise((resolve, reject) => {
        const doc = flattenedDoc;
        let errors = [];

        // Jobs
        errors = errors.concat(validateJobSchema(doc));

        // Workflow graph
        doc.workflowGraph = generateWorkflowGraph(doc);
        errors = errors.concat(validateWorkflowGraph(doc));

        // Check if build cluster annotation is valid
        return validateBuildClusterAnnotation(doc, buildClusterFactory)
            .then((errs) => {
                errors = errors.concat(errs);

                if (errors.length > 0) {
                    return reject(new Error(errors.join('\n')));
                }

                return resolve(doc);
            });
    })
);
