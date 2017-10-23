'use strict';

const Joi = require('joi');
const Hoek = require('hoek');
const clone = require('clone');
const WorkflowParser = require('screwdriver-workflow-parser');

// Actual environment size is limited by space, not quantity.
// We do this to force sd.yaml to be simpler.
const MAX_ENVIRONMENT_VARS = 25;
// If they are trying to execute >25 permutations,
// maybe there is a better way to accomplish their goal.
const MAX_PERMUTATIONS = 25;

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
    const environmentSize = Object.keys(matrix).length + Object.keys(environment).length;

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
            environment: Joi.object().max(MAX_ENVIRONMENT_VARS).default({})
        })
        .unknown(true)
        // Add documentation
        .options({
            language: {
                object: {
                    min: 'requires at least one step',
                    max: `can only have ${MAX_ENVIRONMENT_VARS} environment variables defined`
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
 * Get the defined workflow, or if missing generate one (list of all jobs in series)
 * @method generateWorkflow
 * @param  {Object}          doc Document that went through flattening
 * @return {Array}               Workflow of jobs
 */
function generateWorkflow(doc) {
    const workflow = Hoek.reach(doc, 'workflow');

    // if not defined by user, get default workflow
    if (!workflow) {
        return Object.keys(doc.jobs);
    }

    return ['main'].concat(workflow);
}

/**
 * Get the defined workflowGraph, or if missing generate one (list of all jobs in series)
 * @method generateWorkflowGraph
 * @param  {Object}          doc Document that went through flattening
 * @return {Object}              WorkflowGraph that consists of nodes and edges
 */
function generateWorkflowGraph(doc) {
    // In case doc got changed during workflow parsing
    const cloneDoc = clone(doc);

    if (doc.workflow) {
        return WorkflowParser.getWorkflow(cloneDoc, { useLegacy: true });
    }

    return WorkflowParser.getWorkflow(cloneDoc);
}

/**
 * Ensure the workflow is a valid one
 *  - Main job exists
 *  - Main is first
 *  - Contains all defined jobs (no extra or missing)
 * @method validateWorkflow
 * @param  {Object}          doc Document that went through flattening
 * @return {Array}               List of errors
 */
function validateWorkflow(doc) {
    const hasMain = Object.keys(doc.jobs).includes('main');

    if (!hasMain) {
        return ['Jobs: "main" is required'];
    }

    // This happens when user defines main in their workflow
    const mainCount = (doc.workflow.filter(job => job === 'main')).length;

    if (mainCount !== 1) {
        return ['Workflow: "main" is implied as the first job and must be excluded'];
    }
    // Validate that workflow contains just the jobs in `jobs`
    // @TODO Support complex workflow like series and parallel
    const sortedJobList = JSON.stringify(clone(Object.keys(doc.jobs)).sort());
    const sortedWorkflow = JSON.stringify(clone(doc.workflow).sort());

    if (sortedWorkflow !== sortedJobList) {
        return ['Workflow: must contain all the jobs listed in "jobs"'];
    }

    return [];
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
 * too many environment variables or must have all jobs in the workflow.
 * @method
 * @param  {Object}   flattenedDoc Document that went through flattening
 * @param  {Function} callback     Function to call when done (err, doc)
 * @param  {Promise}
 */
module.exports = flattenedDoc => (
    new Promise((resolve, reject) => {
        const doc = flattenedDoc;
        const hasRequires = Object.keys(doc.jobs).some(jobName => doc.jobs[jobName].requires);
        let errors = [];

        // Jobs
        errors = errors.concat(validateJobSchema(doc));

        // Workflow. Remove this after we stop supporting workflow
        if (doc.workflow || !hasRequires) {
            doc.workflow = generateWorkflow(doc);
            errors = errors.concat(validateWorkflow(doc));
        }

        doc.workflowGraph = generateWorkflowGraph(doc);
        errors = errors.concat(validateWorkflowGraph(doc));

        if (errors.length > 0) {
            return reject(new Error(errors.join('\n')));
        }

        return resolve(doc);
    })
);
