'use strict';

const Joi = require('joi');
const SCHEMA_CONFIG = require('screwdriver-data-schema').config.base.config;

/**
 * Structural Phase
 *  - Validate basic structure of the parsed YAML
 * @method
 * @param   {Object}   doc      Direct document from YAML parsing
 * @returns {Promise}
 */
module.exports = doc => (
    new Promise((resolve, reject) => {
        Joi.validate(doc, SCHEMA_CONFIG, {
            abortEarly: false
        }, (err, data) => {
            if (err) {
                return reject(err);
            }

            return resolve(data);
        });
    })
);
