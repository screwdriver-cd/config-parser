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
 * Merge parsed yaml shared config with pipeline template shared config
 * Pipeline yaml will take precedence over pipeline template
 * @method mergeSetting
 * @method
 * @param   {Object}        parsedDoc              Parsed screwdriver yaml
 * @param   {Object}        pipelineTemplate       Pipeline template
 * @return  {Object}                               Merged yaml settings
 */
function mergeSharedConfig(parsedDoc, pipelineTemplate) {
    const newPipeline = pipelineTemplate.config;
    const yamlSharedConfig = parsedDoc.shared || {};
    const templateSharedConfig = newPipeline.shared || {};

    const mergedEnvironment = {
        SD_PIPELINE_TEMPLATE_FULLNAME: `${pipelineTemplate.namespace}/${pipelineTemplate.name}`,
        SD_PIPELINE_TEMPLATE_NAME: pipelineTemplate.name,
        SD_PIPELINE_TEMPLATE_NAMESPACE: pipelineTemplate.namespace,
        SD_PIPELINE_TEMPLATE_VERSION: pipelineTemplate.version,
        ...templateSharedConfig.environment,
        ...yamlSharedConfig.environment
    };

    const mergedSettings = {
        ...templateSharedConfig.settings,
        ...yamlSharedConfig.settings
    };

    const mergedImage = yamlSharedConfig.image || templateSharedConfig.image;

    newPipeline.shared = {
        ...templateSharedConfig,
        environment: mergedEnvironment,
        settings: mergedSettings
    };

    if (mergedImage) {
        newPipeline.shared.image = mergedImage;
    }

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

    const mergedDoc = mergeSharedConfig(parsedDoc, pipelineTemplate);

    return { mergedDoc, warnings };
};
