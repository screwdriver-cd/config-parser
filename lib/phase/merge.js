'use strict';

const Hoek = require('@hapi/hoek');
const clone = require('clone');
const TEMPLATE_NAME_REGEX_WITH_NAMESPACE =
    require('screwdriver-data-schema').config.regex.FULL_TEMPLATE_NAME_WITH_NAMESPACE;
const ALLOWED_JOB_FIELDS_WITH_PIPELINE_TEMPLATE = [
    'settings',
    'requires',
    'image',
    'environment',
    'annotations',
    'sourcePaths'
];
const { merge } = require('./flatten');

/**
 * Fetch pipeline template
 * @method fetchPipelineTemplate
 * @method
 * @param   {String}                          pipelineTemplateName                        Pipeline template name
 * @param   {PipelineTemplateVersionFactory}  config.pipelineTemplateVersionFactory       PipelineTemplateVersion Factory to get pipeline templates
 * @param   {PipelineTemplateTagFactory}      config.pipelineTemplateTagFactory           PipelineTemplateTag Factory to get pipeline templates tag
 * @param   {PipelineTemplateFactory}         config.pipelineTemplateFactory              PipelineTemplate Factory to get pipeline templates
 * @return  {Object}                                                                      Pipeline Template
 */
async function fetchPipelineTemplate(
    pipelineTemplateName,
    pipelineTemplateVersionFactory,
    pipelineTemplateTagFactory,
    pipelineTemplateFactory
) {
    const [, namespace, name, versionOrTag] = TEMPLATE_NAME_REGEX_WITH_NAMESPACE.exec(pipelineTemplateName);
    const templateTag = await pipelineTemplateTagFactory.get({
        name,
        namespace,
        tag: versionOrTag
    });
    const version = templateTag ? templateTag.version : versionOrTag;
    const pipelineTemplate = await pipelineTemplateVersionFactory.getWithMetadata(
        {
            name,
            namespace,
            version
        },
        pipelineTemplateFactory
    );

    return pipelineTemplate;
}

/**
 * Test if an object or an array is empty
 * @method isEmpty
 * @method
 * @param   {Object}        value              value to be tested
 * @return  {Boolean}                          whether passed in value is empty
 */
function isEmpty(value) {
    if (Array.isArray(value)) {
        return !value.length;
    }

    if (typeof value === 'object') {
        return !Object.entries(value).length;
    }

    return false;
}

/**
 * Merge user job with pipeline template job config
 * @param  {Object} parsedDoc                     Parsed screwdriver yaml
 * @param  {Object} newPipeline                   Pipeline template config
 * @param  {Object} pipelineTemplate              Pipeline template
 * @return {Object}                  Pipeline template config with merged job
 */
function handlePipelineTemplateMergeForJobs(parsedDoc, newPipeline, pipelineTemplate) {
    // Check if job names are valid
    if (parsedDoc.jobs) {
        const pipelineTemplateJobNames = Object.keys(newPipeline.jobs);
        const fieldsToFlatten = ['image', 'requires'];

        // Flatten jobs
        Object.keys(parsedDoc.jobs).forEach(jobName => {
            const newJob = clone(pipelineTemplate.config.jobs[jobName]);
            const oldJob = clone(parsedDoc.jobs[jobName]);

            // Case: Job name exists in pipeline template
            // Make sure customized jobs that exist in pipeline template
            // only have certain fields set and flatten those fields
            if (pipelineTemplateJobNames.includes(jobName)) {
                const userJobFields = Object.keys(parsedDoc.jobs[jobName]);
                const hasExtraField = userJobFields.some(
                    field => !ALLOWED_JOB_FIELDS_WITH_PIPELINE_TEMPLATE.includes(field)
                );

                if (hasExtraField) {
                    throw new Error(
                        `Job "${jobName}" has unsupported fields in user yaml. Can only set ${ALLOWED_JOB_FIELDS_WITH_PIPELINE_TEMPLATE}.`
                    );
                }

                // Replace fields
                fieldsToFlatten.forEach(key => {
                    if (oldJob[key]) {
                        newJob[key] = oldJob[key];
                    }
                });

                // Merge job environment
                if (oldJob.environment || newJob.environment) {
                    newJob.environment = {
                        ...newJob.environment,
                        ...oldJob.environment
                    };
                }

                // Merge job annotations
                if (oldJob.annotations || newJob.annotations) {
                    newJob.annotations = {
                        ...newJob.annotations,
                        ...oldJob.annotations
                    };
                }

                // Merge job sourcePaths
                if (oldJob.sourcePaths || newJob.sourcePaths) {
                    newJob.sourcePaths = Array.from(
                        new Set([...(newJob.sourcePaths || []), ...(oldJob.sourcePaths || [])])
                    );
                }

                // Merge settings
                // Replace settings if empty object
                if (Hoek.deepEqual(oldJob.settings, {})) {
                    newJob.settings = {};
                } else {
                    newJob.settings = newJob.settings || {};
                    Object.assign(newJob.settings, oldJob.settings || {});
                }

                newPipeline.jobs[jobName] = newJob;
            } else {
                // Case: Job name does not exist in pipeline template
                newPipeline.jobs[jobName] = oldJob;
            }
        });
    }

    return newPipeline;
}

/**
 * Overlays the fields specified in user shared yaml on top of the defaults in pipeline template job
 *
 * @method mergeSharedWithPipelineTemplateJob
 * @param  {Job}          shared A kind of default Job template
 * @param  {Object}       jobs   Object with all the jobs
 * @return {Object}              New object with jobs after merging
 */
function mergeSharedWithPipelineTemplateJob(shared, jobs) {
    const newJobs = {};
    const fieldsToFlatten = ['image', 'matrix', 'steps', 'template', 'description', 'cache', 'parameters', 'provider'];

    Object.keys(jobs).forEach(jobName => {
        const oldJob = clone(shared);
        const newJob = clone(jobs[jobName]);

        if (oldJob) {
            // Replace
            fieldsToFlatten.forEach(key => {
                if (oldJob[key]) {
                    newJob[key] = oldJob[key];
                }
            });

            // Replace settings if empty object
            if (Hoek.deepEqual(oldJob.settings, {})) {
                newJob.settings = oldJob.settings;
            }

            merge(newJob, oldJob);
        }

        newJobs[jobName] = newJob;
    });

    return newJobs;
}

/**
 * Merge parsed yaml config with pipeline template config
 * Pipeline yaml will take precedence over pipeline template
 * @method mergePipelineLevelConfig
 * @method
 * @param   {Object}        parsedDoc              Parsed screwdriver yaml
 * @param   {Object}        pipelineTemplate       Pipeline template
 * @return  {Object}                               Yaml with merged pipeline level settings
 */
function mergePipelineLevelConfig(parsedDoc, pipelineTemplate) {
    let newPipeline = pipelineTemplate.config;

    // Merge user shared section with pipeline template job section, with priority for shared
    const mergedDoc = mergeSharedWithPipelineTemplateJob(parsedDoc.shared, pipelineTemplate.config.jobs);

    newPipeline.jobs = mergedDoc;

    // Handle jobs config
    newPipeline = handlePipelineTemplateMergeForJobs(parsedDoc, newPipeline, pipelineTemplate);

    // merge cache config
    const yamlCacheConfig = parsedDoc.cache || {};
    const templateCacheConfig = newPipeline.cache || {};
    const newJobCache = yamlCacheConfig.job || {};
    const oldJobCache = templateCacheConfig.job || {};

    newPipeline.cache = {
        ...templateCacheConfig,
        ...yamlCacheConfig
    };

    if (!isEmpty(oldJobCache)) {
        newPipeline.cache = {
            ...newPipeline.cache,
            job: {
                ...oldJobCache,
                ...newJobCache
            }
        };
    }

    // delete cache if it's empty otherwise validation will fail
    if (isEmpty(newPipeline.cache)) {
        delete newPipeline.cache;
    }

    // merge subscribe config
    const yamlSubscribeConfig = parsedDoc.subscribe || {};
    const templateSubscribeConfig = newPipeline.subscribe || {};
    const newScmUrls = yamlSubscribeConfig.scmUrls || [];
    const oldScmUrls = templateSubscribeConfig.scmUrls || [];

    if (!isEmpty(oldScmUrls) || !isEmpty(newScmUrls)) {
        // filter to remove duplicate
        const reducedOldScmUrl = oldScmUrls.filter(
            scmUrl =>
                !newScmUrls.find(
                    newScmUrl => JSON.stringify(Object.keys(newScmUrl)) === JSON.stringify(Object.keys(scmUrl))
                )
        );

        newPipeline.subscribe = {
            ...templateSubscribeConfig,
            ...yamlSubscribeConfig,
            scmUrls: [...reducedOldScmUrl, ...newScmUrls]
        };
    }

    // merge parameters
    const newParameters = parsedDoc.parameters || {};
    const oldParameters = newPipeline.parameters || {};
    const newParametersNames = Object.keys(newParameters);

    for (const [key, value] of Object.entries(oldParameters)) {
        if (!newParametersNames.includes(key)) {
            newParameters[key] = value;
        } else if (!newParameters[key].description && value.description) {
            newParameters[key] = {
                value: newParameters[key],
                description: value.description
            };
        }
    }

    newPipeline.parameters = newParameters;

    // merge annotations
    newPipeline.annotations = {
        ...newPipeline.annotations,
        ...parsedDoc.annotations
    };

    if (parsedDoc.childPipelines) {
        newPipeline.childPipelines = parsedDoc.childPipelines;
    }

    return newPipeline;
}

/**
 * Merge parsed yaml config with pipeline template config
 * Pipeline yaml will take precedence over pipeline template
 * @method mergeConfig
 * @method
 * @param   {Object}        parsedDoc              Parsed screwdriver yaml
 * @param   {Object}        pipelineTemplate       Pipeline template
 * @return  {Object}                               Merged yaml settings
 */
function mergeConfig(parsedDoc, pipelineTemplate) {
    const newPipeline = mergePipelineLevelConfig(parsedDoc, pipelineTemplate);
    const yamlSharedConfig = parsedDoc.shared || {};
    const mergedEnvironment = {
        SD_PIPELINE_TEMPLATE_FULLNAME: `${pipelineTemplate.namespace}/${pipelineTemplate.name}`,
        SD_PIPELINE_TEMPLATE_NAME: pipelineTemplate.name,
        SD_PIPELINE_TEMPLATE_NAMESPACE: pipelineTemplate.namespace,
        SD_PIPELINE_TEMPLATE_VERSION: pipelineTemplate.version,
        ...yamlSharedConfig.environment
    };

    newPipeline.shared = {
        environment: mergedEnvironment,
        settings: yamlSharedConfig.settings || {}
    };

    if (yamlSharedConfig.image) {
        newPipeline.shared.image = yamlSharedConfig.image;
    }

    if (yamlSharedConfig.sourcePaths) {
        newPipeline.shared.sourcePaths = yamlSharedConfig.sourcePaths;
    }

    newPipeline.templateVersionId = pipelineTemplate.id;

    return newPipeline;
}

/**
 * Merge Phase
 *
 * Merge pipeline template with screwdriver yaml
 * @method
 * @param   {Object}                          parsedDoc                                   Document that went through structural parsing
 * @param   {PipelineTemplateVersionFactory}  config.pipelineTemplateVersionFactory       PipelineTemplateVersion Factory to get pipeline templates
 * @param   {PipelineTemplateTagFactory}      config.pipelineTemplateTagFactory           PipelineTemplateTag Factory to get pipeline templates tag
 * @param   {PipelineTemplateFactory}         config.pipelineTemplateFactory              PipelineTemplate Factory to get pipeline templates
 * @returns {Promise}                                                                     Merged pipeline and warnings
 */
module.exports = async (
    parsedDoc,
    pipelineTemplateVersionFactory,
    pipelineTemplateTagFactory,
    pipelineTemplateFactory
) => {
    const warnings = [];
    const pipelineTemplateName = Hoek.reach(parsedDoc, 'template');

    if (!pipelineTemplateName) {
        return { mergedDoc: parsedDoc, warnings };
    }

    const pipelineTemplate = await fetchPipelineTemplate(
        pipelineTemplateName,
        pipelineTemplateVersionFactory,
        pipelineTemplateTagFactory,
        pipelineTemplateFactory
    );

    if (!pipelineTemplate) {
        throw new Error(`Pipeline template ${pipelineTemplateName} does not exist`);
    }

    const mergedDoc = mergeConfig(parsedDoc, pipelineTemplate);

    return { mergedDoc, warnings };
};
