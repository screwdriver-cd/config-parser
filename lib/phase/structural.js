'use strict';

const Joi = require('joi');
const SCHEMA_CONFIG = require('screwdriver-data-schema').config.base.config;

/**
 * Structural Phase
 *  - Validate basic structure of the parsed YAML
 * @method
 * @param  {Object}   doc      Direct document from YAML parsing
 * @param  {Function} callback Function to call when done (err, doc)
 */
module.exports = (doc, callback) => {
    Joi.validate(doc, SCHEMA_CONFIG, {
        abortEarly: false
    }, callback);
};
