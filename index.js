'use strict';

const YamlParser = require('js-yaml');
const Hoek = require('hoek');

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
        return Promise.reject('screwdriver.yaml does not exist. Please ' +
        'create a screwdriver.yaml and try to rerun your build.');
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
 * Parse the configuration from a screwdriver.yaml
 * @method configParser
 * @param  {String}           yaml              Contents of screwdriver.yaml
 * @param  {TemplateFactory}  templateFactory   Template Factory to get templates
 * @returns {Promise}
 */
module.exports = function configParser(yaml, templateFactory) {
    // Convert from YAML to JSON
    return parseYaml(yaml)
        // Basic validation
        .then(phaseValidateStructure)
        // Flatten structures
        .then(parsedDoc => phaseFlatten(parsedDoc, templateFactory))
        // Functionality validation
        .then(phaseValidateFunctionality)
        // Generate Permutations
        .then(phaseGeneratePermutations)
        // Output in the right format
        .then((doc) => {
            const res = {
                annotations: Hoek.reach(doc, 'annotations', { default: {} }),
                jobs: Hoek.reach(doc, 'jobs'),
                childPipelines: Hoek.reach(doc, 'childPipelines', { default: {} }),
                workflowGraph: Hoek.reach(doc, 'workflowGraph')
            };

            if (Hoek.deepEqual(res.childPipelines, {})) {
                delete res.childPipelines;
            }

            return res;
        })
        .catch(err => ({
            annotations: {},
            jobs: {
                main: [{
                    image: 'node:6',
                    commands: [{
                        name: 'config-parse-error',
                        command: `echo "${err}"; exit 1`
                    }],
                    secrets: [],
                    environment: {}
                }]
            },
            workflowGraph: {
                nodes: [
                    { name: '~pr' },
                    { name: '~commit' },
                    { name: 'main' }
                ],
                edges: [
                    { src: '~pr', dest: 'main' },
                    { src: '~commit', dest: 'main' }
                ]
            },
            errors: [err.toString()]
        }));
};
