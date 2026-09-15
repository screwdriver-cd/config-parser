'use strict';

/**
 * Marks an error as a statement about the *user's* pipeline config (bad YAML,
 * a schema violation, a reference to a template/job that doesn't exist, etc.),
 * as opposed to a failure of the parser's own infrastructure (a datastore
 * timeout looking up a template, a dropped connection, and so on).
 *
 * parsePipelineYaml's final .catch() only launders errors of this type into
 * the fallback "config-parse-error" job; anything else propagates, so a
 * transient infrastructure failure aborts instead of being persisted as if it
 * were the user's real config. See screwdriver-models pipeline.sync() for the
 * caller-side half of that guarantee.
 *
 * @class UserConfigError
 * @extends Error
 */
class UserConfigError extends Error {
    /**
     * @param {String} message
     * @param {Error}  [cause]  The original error being wrapped, if any. Its
     *                          message/stack are preserved via toString()/stack
     *                          so wrapping never loses diagnostic information.
     */
    constructor(message, cause) {
        super(message);

        this.name = 'UserConfigError';

        if (cause) {
            this.cause = cause;
            this.stack = cause.stack || this.stack;
        }

        Error.captureStackTrace(this, UserConfigError);
    }

    toString() {
        // Preserve the wrapped error's own string form (e.g. "ValidationError: ...",
        // "YAMLException: ...") since callers/tests match against it, and it ends up
        // verbatim in the fallback job's echoed command and errors[] array.
        return this.cause ? this.cause.toString() : super.toString();
    }
}

module.exports = UserConfigError;
