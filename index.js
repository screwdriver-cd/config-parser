'use strict';

const YamlParser = require('js-yaml');
const Hoek = require('@hapi/hoek');
const shellescape = require('shell-escape');

/* eslint-disable max-len */
const RESERVED_JOB_ANNOTATIONS = require('screwdriver-data-schema').config.annotations.reservedJobAnnotations;
const RESERVED_PIPELINE_ANNOTATIONS = require('screwdriver-data-schema').config.annotations.reservedPipelineAnnotations;
/* eslint-enable max-len */

const phaseValidateStructure = require('./lib/phase/structural');
const phaseFlatten = require('./lib/phase/flatten');
const phaseValidateFunctionality = require('./lib/phase/functional');
const phaseGeneratePermutations = require('./lib/phase/permutation');

/**
 * Parses a yaml file
 * @method parseYaml
 * @param  {String}  yaml Raw yaml
 * @return {Promise}      Resolves POJO containing yaml data
 */
function parseYaml(yaml) {
    // If no yaml exists, throw error
    if (!yaml) {
        return Promise.reject(new Error('screwdriver.yaml does not exist. Please '
            + 'create a screwdriver.yaml and try to rerun your build.'));
    }

    return new Promise((resolve) => {
        const documents = YamlParser.safeLoadAll(yaml);

        // If only one document, return it
        if (documents.length === 1) {
            return resolve(documents[0]);
        }

        // If more than one document, look for "version: 4"
        const doc = documents.find(yamlDoc => yamlDoc && yamlDoc.version === 4);

        if (!doc) {
            throw new YamlParser.YAMLException('Configuration is too ambigious - '
                + 'contains multiple documents without a version hint');
        }

        return resolve(doc);
    });
}

/**
 * Check reserved annotations
 * @method validateReservedAnnotation
 * @param  {Object}               doc Document that went through functional validation
 * @return {Array}                List of warnings
 */
function validateReservedAnnotation(doc) {
    let warnings = [];

    if (RESERVED_PIPELINE_ANNOTATIONS) {
        const pipelineAnnotations = Hoek.reach(doc, 'annotations', { default: {} });

        warnings = warnings.concat(
            Object.keys(pipelineAnnotations).filter((key) => {
                if (key.startsWith('screwdriver.cd/')) {
                    return RESERVED_PIPELINE_ANNOTATIONS.indexOf(key) === -1;
                }

                return false;
            })
                .map(value => `${value} is not an annotation that is reserved for Pipeline-Level`)
        );
    }

    if (RESERVED_JOB_ANNOTATIONS) {
        Object.keys(doc.jobs).forEach((jobName) => {
            const jobAnnotations = Hoek.reach(doc.jobs[jobName], 'annotations', {
                default: {}
            });

            warnings = warnings.concat(
                Object.keys(jobAnnotations).filter((key) => {
                    if (key.startsWith('screwdriver.cd/')) {
                        return RESERVED_JOB_ANNOTATIONS.indexOf(key) === -1;
                    }

                    return false;
                })
                    .map(value => `${value} is not an annotation that is reserved for Job-Level`)
            );
        });
    }

    return warnings;
}

/**
 * Check that the version is specify
 * @method validateTemplateVersion
 * @param  {Object}           doc               Document that went through structural parsing
 * @param  {TemplateFactory}  templateFactory   Template Factory to get templates
 * @return {Array}                              List of warnings
 */
function validateTemplateVersion(doc, templateFactory) {
    let warnings = [];

    let template = Hoek.reach(doc.shared, 'template');

    if (template !== undefined) {
        const { isVersion, isTag } = templateFactory.getFullNameAndVersion(template);

        if (!isVersion && !isTag) {
            warnings = warnings.concat(
                `${template} template in shared settings should be explicitly versioned`
            );
        }
    }

    Object.keys(doc.jobs).forEach((jobName) => {
        template = Hoek.reach(doc.jobs[jobName], 'template');

        if (template !== undefined) {
            const { isVersion, isTag } = templateFactory.getFullNameAndVersion(template);

            if (!isVersion && !isTag) {
                warnings = warnings.concat(
                    `${template} template in ${jobName} job should be explicitly versioned`
                );
            }
        }
    });

    return warnings;
}

/**
 * Parse the configuration from a screwdriver.yaml
 * @method configParser
 * @param   {String}               yaml                Contents of screwdriver.yaml
 * @param   {TemplateFactory}      templateFactory     Template Factory to get templates
 * @param   {BuildClusterFactory}  buildClusterFactory Build cluster Factory to get build clusters
 * @param   {TriggerFactory}       triggerFactory      Trigger Factory to find external triggers
 * @param   {Number}               pipelineId          Id of the current pipeline
 * @returns {Promise}
 */
module.exports = function configParser(
    yaml, templateFactory, buildClusterFactory, triggerFactory, pipelineId
) {
    let warnMessages = [];

    // Convert from YAML to JSON
    return parseYaml(yaml)
        // Basic validation
        .then(phaseValidateStructure)
        // Flatten structures
        .then((parsedDoc) => {
            warnMessages = warnMessages.concat(validateTemplateVersion(parsedDoc, templateFactory));

            return phaseFlatten(parsedDoc, templateFactory);
        })
        // Functionality validation
        .then(flattenedDoc => phaseValidateFunctionality(flattenedDoc,
            buildClusterFactory, triggerFactory, pipelineId))
        // Check warnMessages
        .then((doc) => {
            warnMessages = warnMessages.concat(validateReservedAnnotation(doc));

            return doc;
        })
        // Generate Permutations
        .then(phaseGeneratePermutations)
        // Output in the right format
        .then((doc) => {
            const res = {
                annotations: Hoek.reach(doc, 'annotations', { default: {} }),
                jobs: Hoek.reach(doc, 'jobs'),
                childPipelines: Hoek.reach(doc, 'childPipelines', { default: {} }),
                workflowGraph: Hoek.reach(doc, 'workflowGraph'),
                parameters: Hoek.reach(doc, 'parameters'),
                subscribe: Hoek.reach(doc, 'subscribe', { default: {} })
            };

            if (warnMessages.length > 0) {
                res.warnMessages = warnMessages;
            }

            if (Hoek.deepEqual(res.childPipelines, {})) {
                delete res.childPipelines;
            }

            return res;
        })
        .catch(err => ({
            annotations: {},
            jobs: {
                main: [{
                    image: 'node:12',
                    commands: [{
                        name: 'config-parse-error',
                        command: `echo ${shellescape([err.toString()])}; exit 1`
                    }],
                    secrets: [],
                    environment: {}
                }]
            },
            workflowGraph: {
                nodes: [
                    { name: '~pr' },
                    { name: '~commit' },
                    { name: 'main' },
                    { name: '~pr:/.*/' }
                ],
                edges: [
                    { src: '~pr', dest: 'main' },
                    { src: '~commit', dest: 'main' },
                    { src: '~pr:/.*/', dest: 'main' }
                ]
            },
            errors: [err.toString()]
        }));
};
