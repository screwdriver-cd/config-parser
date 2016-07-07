# config-parse(1) -- screwdriver config parser

## SYNOPSIS

    config-parse [options] <screwdriver.yaml> <job-name> <build-number>

## DESCRIPTION

The config-parse utility parses a given `screwdriver.yaml` and writes out the list of steps to run as well as environment variables to set.

It selects the steps and environment variables based on the specified `job-name` and `build-number`.  The `job-name` is the name specified in the `screwdriver.yaml` while the `build-number` is an incrementing number whose fractional part references which matrix permutation to run.

For more information on build, please see the [domain model](https://screwdriver-cd.github.io/guide/architecture/domain/).

## OPTIONS

`-h, --help`
    output usage information

`-V, --version`
    output the version number

`-a, --artifactdir <directory>`
    Specify an alternative artifact directory (default ./artifacts)

## EXAMPLE

To view the output from the main build with run number 15.1, run the following:

    config-parse ./screwdriver.yaml main 15.1

## EXIT CODES

`1`
    "Bad arguments passed to command-line"
    Check that you passed the required arguments, for more information see `--help`.

`2`
    "Specified `screwdriver.yaml` failed validation"
    Please refer to the error message for more specific details.

`3`
    "Unable to read specified `screwdriver.yaml`"
    Ensure the file exists and you have permission to read it.

`4`
    "Specified `job-name`/`build-number` not found in the `screwdriver.yaml`"
    Please refer to the error message for a list of valid `job-name`/`build-number` combinations.
