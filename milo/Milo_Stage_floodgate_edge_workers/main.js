/* ***********************************************************************
 * ADOBE CONFIDENTIAL
 * ___________________
 *
 * Copyright 2024 Adobe
 * All Rights Reserved.
 *
 * NOTICE: All information contained herein is, and remains
 * the property of Adobe and its suppliers, if any. The intellectual
 * and technical concepts contained herein are proprietary to Adobe
 * and its suppliers and are protected by all applicable intellectual
 * property laws, including trade secret and copyright laws.
 * Dissemination of this information or reproduction of this material
 * is strictly forbidden unless prior written permission is obtained
 * from Adobe.
 ************************************************************************* */

import { httpRequest } from 'http-request';
import { logger } from 'log';
import { Cookies } from 'cookies';

const PINK_ENV = 'pink';
const CONFIG_URL = '/drafts/sukamat/akamai/edge-worker-config.json';

async function getConfig() {
    // http subrequest to get the body of the json file in Adobe's main server
    const configReq = await httpRequest(CONFIG_URL);
    const configObj = await configReq.json();
    return configObj;
}

export async function onClientRequest(request) {
    const fullConfig = await getConfig();
    const config = fullConfig.fgrelease_new;
    const requestPath = request.path;
    let origin;

    // Select the matching release based on the release color
    const matchingReleases = config.data.filter(
        (release) => release.release === PINK_ENV
    );

    // If no matching release is found, log a message
    if (matchingReleases.length === 0) {
        logger.log(`No release found. Serving original content for the requested path ${requestPath}`);
    } else {
        // Select the matching release based on the request path
        const matchingPaths = matchingReleases.filter((release) => {
            const pathsRegex = new RegExp(release.pathsPattern.replace(/,/g, '|'));
            return pathsRegex.test(requestPath);
        });

        const currentTime = new Date();

        // If no matching path is found, log a message
        if (matchingPaths.length === 0) {
            logger.log(`No paths matched. Serving original content for the requested path ${requestPath}`);
            // Serve original content if no matching path is found
        } else {
            // Select the matching release if current time is within the start and end time
            const matchingPathDateTime = matchingPaths.find((release) => {
                const startTime = new Date(release.startTime);
                const endTime = new Date(release.endTime);
                return currentTime >= startTime && currentTime <= endTime;
            });
            // Select the matching release if current time is before the start time
            const matchingPathBeforeStartTime = matchingPaths.find((release) => {
                const startTime = new Date(release.startTime);
                return currentTime < startTime;
            });

            if (matchingPathDateTime) {
                // If matching release is found with the current time between the start and end time, serve the PINK content
                logger.log(`Serving ${PINK_ENV} Content for ${requestPath},
                            Current Time: ${currentTime},
                            Start Time: ${new Date(matchingPathDateTime.startTime)},
                            End Time: ${new Date(matchingPathDateTime.endTime)},
                            Paths Regex: ${matchingPathDateTime.pathsPattern}`);
                request.setVariable('PMUSER_EW_FG_VERSION', 'pink');
                origin = PINK_ENV;
            } else if (matchingPathBeforeStartTime) {
                // If matching release is found with the current time before the start time
                logger.log(`FG release has not started yet 
                            OR Request path ${requestPath} does not match the FG release. 
                            Checking valid FG cookie for serving PINK content.`);

                // Access the cookies from the request object and display pink content if valid floodgate cookie exists
                // Create a loop to validate all cookie headers executes the length of the array
                const cookieHeader = request.getHeader('Cookie');
                const cookies = new Cookies(cookieHeader);
                const fgCookie = cookies.get('fg');
                const verifyRegex = request.getVariable('PMUSER_EW_FG_NTH_WORD');
                const fgCookiePattern = new RegExp(verifyRegex);

                // boolean - should be true or false
                if (fgCookiePattern.test(fgCookie)) {
                    request.setVariable('PMUSER_EW_FG_VERSION', 'pink');
                    request.setHeader('X-Adobe-Floodgate', 'pink');
                    logger.log('cookie matches: PINK origin');
                    origin = PINK_ENV;
                } else {
                    logger.log("Cookie doesn't match: Go to Main origin");
                }
            } else {
                // If current time is after the end time of all the available releases
                logger.log(
                    `No active FG releases found. Serving original content for the requested path ${requestPath}`
                );
            }
        }
    }

    if (origin) {
        request.route({ origin });
    }
}
