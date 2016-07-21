'use strict';

const Yaml = require('js-yaml');
const Hoek = require('hoek');
const Async = require('async');

const phaseValidateStructure = require('./lib/phase/structural');
const phaseFlatten = require('./lib/phase/flatten');
const phaseValidateFunctionality = require('./lib/phase/functional');
const phaseGeneratePermutations = require('./lib/phase/permutation');

/**
 * Parse the configuration from a screwdriver.yaml
 * @method configParser
 * @param  {String}   yaml      Contents of screwdriver.yaml
 * @param  {Function} callback  Function to call when done (error, { workflow, jobs })
 */
module.exports = function configParser(yaml, callback) {
    Async.waterfall([
        // Convert from YAML to JSON
        (next) => {
            let parsedYaml;

            try {
                parsedYaml = Yaml.safeLoad(yaml);
            } catch (parseError) {
                return next(parseError);
            }

            return next(null, parsedYaml);
        },
        // Basic validation
        phaseValidateStructure,
        // Flatten structures
        phaseFlatten,
        // Functionality validation
        phaseValidateFunctionality,
        // Generate Permutations
        phaseGeneratePermutations,
        // Output in the right format
        (doc, next) => next(null, {
            jobs: Hoek.reach(doc, 'jobs'),
            workflow: Hoek.reach(doc, 'workflow')
        })
    ], callback);
};
