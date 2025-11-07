'use strict';

const YamlParser = require('js-yaml');
const Hoek = require('@hapi/hoek');
const shellescape = require('shell-escape');

/* eslint-disable max-len */
const RESERVED_JOB_ANNOTATIONS = require('screwdriver-data-schema').config.annotations.reservedJobAnnotations;
const RESERVED_PIPELINE_ANNOTATIONS = require('screwdriver-data-schema').config.annotations.reservedPipelineAnnotations;
const SCHEMA_PIPELINE_TEMPLATE = require('screwdriver-data-schema').config.pipelineTemplate.template;
/* eslint-enable max-len */

const phaseValidateStructure = require('./lib/phase/structural');
const phaseMerge = require('./lib/phase/merge');
const {
    flattenSharedIntoJobs,
    handleMergeSharedStepsAnnotation,
    flattenPhase: phaseFlatten,
    flattenTemplates
} = require('./lib/phase/flatten');
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
        return Promise.reject(
            new Error('screwdriver.yaml does not exist. Please create a screwdriver.yaml and try to rerun your build.')
        );
    }

    return new Promise(resolve => {
        const documents = YamlParser.loadAll(yaml);

        // If only one document, return it
        if (documents.length === 1) {
            resolve(documents[0]);

            return;
        }

        // If more than one document, look for "version: 4"
        const doc = documents.find(yamlDoc => yamlDoc && yamlDoc.version === 4);

        if (!doc) {
            throw new YamlParser.YAMLException(
                'Configuration is too ambigious - contains multiple documents without a version hint'
            );
        }

        resolve(doc);
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
            Object.keys(pipelineAnnotations)
                .filter(key => {
                    if (key.startsWith('screwdriver.cd/')) {
                        return RESERVED_PIPELINE_ANNOTATIONS.indexOf(key) === -1;
                    }

                    return false;
                })
                .map(value => `${value} is not an annotation that is reserved for Pipeline-Level`)
        );
    }

    if (RESERVED_JOB_ANNOTATIONS) {
        Object.keys(doc.jobs).forEach(jobName => {
            const jobAnnotations = Hoek.reach(doc.jobs[jobName], 'annotations', {
                default: {}
            });

            if (Object.keys(jobAnnotations).some(key => key.startsWith('screwdriver.cd/sdAdmin'))) {
                throw new Error('Annotations starting with screwdriver.cd/sdAdmin are reserved for system use only');
            }

            warnings = warnings.concat(
                Object.keys(jobAnnotations)
                    .filter(key => {
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
 * Check that the version is specified
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
            warnings = warnings.concat(`${template} template in shared settings should be explicitly versioned`);
        }
    }

    Object.keys(doc.jobs).forEach(jobName => {
        template = Hoek.reach(doc.jobs[jobName], 'template');

        if (template !== undefined) {
            const { isVersion, isTag } = templateFactory.getFullNameAndVersion(template);

            if (!isVersion && !isTag) {
                warnings = warnings.concat(`${template} template in ${jobName} job should be explicitly versioned`);
            }
        }
    });

    return warnings;
}

/**
 * Parse the configuration from a screwdriver.yaml
 * @method parsePipelineYaml
 * @param   {Object}                          config
 * @param   {String}                          config.yaml                                 Contents of screwdriver.yaml
 * @param   {TemplateFactory}                 config.templateFactory                      Template Factory to get templates
 * @param   {PipelineTemplateVersionFactory}  config.pipelineTemplateVersionFactory       PiplineTemplateVersion Factory to get pipeline templates
 * @param   {PipelineTemplateTagFactory}      config.pipelineTemplateTagFactory           PipelineTemplateTag Factory to get pipeline templates tag
 * @param   {PipelineTemplateFactory}         config.pipelineTemplateFactory              PipelineTemplate Factory to get pipeline templates meta
 * @param   {BuildClusterFactory}             config.buildClusterFactory                  Build cluster Factory to get build clusters
 * @param   {TriggerFactory}                  [config.triggerFactory]                     Trigger Factory to find external triggers
 * @param   {Number}                          [config.pipelineId]                         ID of the current pipeline
 * @param   {Boolean}                         [config.notificationsValidationErr]         Throw error when notifications validation fails (default true);
 *                                                                                        otherwise return warning
 * @returns {Promise}
 */
function parsePipelineYaml({
    yaml,
    templateFactory,
    pipelineTemplateVersionFactory,
    pipelineTemplateTagFactory,
    pipelineTemplateFactory,
    buildClusterFactory,
    triggerFactory,
    pipelineId,
    notificationsValidationErr
}) {
    let warnMessages = [];

    // Convert from YAML to JSON
    return (
        parseYaml(yaml)
            // Validate user config before mergin with pipeline template
            .then(doc => phaseValidateStructure(doc, true))
            // Merge Pipeline template
            .then(parsedDoc =>
                phaseMerge(
                    parsedDoc,
                    pipelineTemplateVersionFactory,
                    pipelineTemplateTagFactory,
                    pipelineTemplateFactory
                ).then(({ warnings, mergedDoc }) => {
                    warnMessages = warnMessages.concat(warnings);

                    return mergedDoc;
                })
            )
            // Validate merged pipeline config
            .then(phaseValidateStructure)
            // Flatten structures
            .then(parsedDoc => {
                warnMessages = warnMessages.concat(validateTemplateVersion(parsedDoc, templateFactory));

                return phaseFlatten(parsedDoc, templateFactory).then(({ warnings, flattenedDoc }) => {
                    warnMessages = warnMessages.concat(warnings);

                    return flattenedDoc;
                });
            })
            // Functionality validation
            .then(flattenedDoc =>
                phaseValidateFunctionality({
                    flattenedDoc,
                    buildClusterFactory,
                    triggerFactory,
                    pipelineId,
                    notificationsValidationErr: notificationsValidationErr !== false
                })
            )
            // Check warnMessages
            .then(({ doc, warnings }) => {
                warnMessages = warnMessages.concat(warnings, validateReservedAnnotation(doc));

                return doc;
            })
            // Generate Permutations
            .then(phaseGeneratePermutations)
            // Output in the right format
            .then(doc => {
                const jobs = Hoek.reach(doc, 'jobs');
                const res = {
                    annotations: Hoek.reach(doc, 'annotations', { default: {} }),
                    jobs,
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

                const stages = Hoek.reach(doc, 'stages', { default: {} });

                if (!Hoek.deepEqual(stages, {})) {
                    res.stages = stages;
                }

                const templateVersionId = Hoek.reach(doc, 'templateVersionId');

                if (templateVersionId) {
                    res.templateVersionId = templateVersionId;
                }

                return res;
            })
            .catch(err => ({
                annotations: {},
                jobs: {
                    main: [
                        {
                            image: 'node:18',
                            commands: [
                                {
                                    name: 'config-parse-error',
                                    command: `echo ${shellescape([err.toString()])}; exit 1`
                                }
                            ],
                            secrets: [],
                            environment: {
                                SD_SKIP_REPOSITORY_CLONE: 'true'
                            }
                        }
                    ]
                },
                workflowGraph: {
                    nodes: [{ name: '~pr' }, { name: '~commit' }, { name: 'main' }, { name: '~pr:/.*/' }],
                    edges: [
                        { src: '~pr', dest: 'main' },
                        { src: '~commit', dest: 'main' },
                        { src: '~pr:/.*/', dest: 'main' }
                    ]
                },
                errors: [err.toString()]
            }))
    );
}

/**
 * Parses pipeline template configuration
 * @method parsePipelineTemplate
 * @param   {Object}          config
 * @param   {String}          config.yaml           Pipeline Template
 * @return  {Object}                                Pipeline Template
 */
async function parsePipelineTemplate({ yaml }) {
    const configToValidate = await parseYaml(yaml);
    const pipelineTemplate = await SCHEMA_PIPELINE_TEMPLATE.validateAsync(configToValidate, {
        abortEarly: false
    });
    const pipelineTemplateConfig = pipelineTemplate.config;

    // flatten pipeline template shared setting into jobs
    pipelineTemplateConfig.jobs = flattenSharedIntoJobs(pipelineTemplateConfig.shared, pipelineTemplateConfig.jobs);

    const mergedJobs = {};

    // Handle mergeSharedSteps annotation
    Object.keys(pipelineTemplateConfig.jobs).forEach(j => {
        mergedJobs[j] = handleMergeSharedStepsAnnotation({
            sharedConfig: pipelineTemplateConfig.shared,
            jobConfig: pipelineTemplateConfig.jobs[j]
        });
        delete mergedJobs[j].annotations['screwdriver.cd/mergeSharedSteps'];
    });
    delete pipelineTemplateConfig.shared;
    pipelineTemplateConfig.jobs = mergedJobs;

    // Add workflowGraph
    const { doc } = await phaseValidateFunctionality({
        flattenedDoc: pipelineTemplateConfig,
        isPipelineTemplate: true
    });

    pipelineTemplate.workflowGraph = doc.workflowGraph;
    delete doc.workflowGraph;
    pipelineTemplate.config = doc;

    return pipelineTemplate;
}

/**
 * Generates pipeline template configuration for the validator
 * @method validatePipelineTemplate
 * @param   {Object}          config
 * @param   {String}          config.yaml             Pipeline Template
 * @param   {TemplateFactory} config.templateFactory  Template Factory to get templates
 * @return  {Object}                                  Pipeline Template
 */
async function validatePipelineTemplate({ yaml, templateFactory }) {
    const pipelineTemplate = await parsePipelineTemplate({ yaml });

    // Merge template steps for validator
    const { newJobs } = await flattenTemplates(pipelineTemplate.config, templateFactory, true);

    pipelineTemplate.config.jobs = newJobs;

    return pipelineTemplate;
}

module.exports = {
    parsePipelineYaml,
    parsePipelineTemplate,
    validatePipelineTemplate
};
