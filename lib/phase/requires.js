'use strict';

/**
 * Normalize requires value to array
 * @method normalizeRequires
 * @param  {String|Array|undefined|null} requiresValue Value to normalize
 * @return {Array}
 */
function normalizeRequires(requiresValue) {
    if (Array.isArray(requiresValue)) {
        return requiresValue;
    }

    if (!requiresValue) {
        return [];
    }

    return [requiresValue];
}

module.exports = {
    normalizeRequires
};
