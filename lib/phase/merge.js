'use strict';

const Hoek = require('@hapi/hoek');
const TEMPLATE_NAME_REGEX_WITH_NAMESPACE =
    require('screwdriver-data-schema').config.regex.FULL_TEMPLATE_NAME_WITH_NAMESPACE;

/**
 * Fetch pipeline template
 * @method fetchPipelineTemplate
 * @method
 * @param   {String}                          pipelineTemplateName                        Pipeline template name
 * @param   {PipelineTemplateVersionFactory}  config.pipelineTemplateVersionFactory       PiplineTemplateVersion Factory to get pipeline templates
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
 * Merge parsed yaml config with pipeline template config
 * Pipeline yaml will take precedence over pipeline template
 * @method mergePipelineLevelConfig
 * @method
 * @param   {Object}        parsedDoc              Parsed screwdriver yaml
 * @param   {Object}        pipelineTemplate       Pipeline template
 * @return  {Object}                               Yaml with merged pipeline level settings
 */
function mergePipelineLevelConfig(parsedDoc, pipelineTemplate) {
    const newPipeline = pipelineTemplate.config;

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

    newPipeline.templateVersionId = pipelineTemplate.id;

    return newPipeline;
}

/**
 * Merge Phase
 *
 * Merge pipeline template with screwdriver yaml
 * @method
 * @param   {Object}                          parsedDoc                                   Document that went through structural parsing
 * @param   {PipelineTemplateVersionFactory}  config.pipelineTemplateVersionFactory       PiplineTemplateVersion Factory to get pipeline templates
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
