import { MongoDB } from "./drivers/database/mongodb";

const request = require('request-promise');
const { Client } = require('@elastic/elasticsearch');
const AWS = require('aws-sdk');

// Dotenv setup
require('dotenv').config();

let client, s3;

//@ts-ignore
export const changeObjectAuthorHandler = async (event, context, callback) => {
    client = setupElasticsearch();
    s3 = setupAWS();

    // event.body gets the body of the request
    // body will be structured as such: {
    //      from:       ID of the person to transfer from
    //      to:         ID of the person to transfer to
    //      objectIDs:  Array of object IDs to change
    // }
    const { fromUserID, toUserID, objectIDs } = JSON.parse(event.body);

    const db = await MongoDB.getInstance();

    let fromObjects = await db.getAuthorLearningObjects(fromUserID, objectIDs);
    let toObjects = await db.getAuthorLearningObjects(toUserID);
    let newAuthor = await db.getUserAccount(toUserID);
    let oldAuthor = await db.getUserAccount(fromUserID);
    let newAuthorAccessID = await db.getFileAccessID(newAuthor.username);
    let oldAuthorAccessID = await db.getFileAccessID(oldAuthor.username);

    fromObjects.map(async learningObject => {
        const cuid = learningObject.cuid;
        await copyFiles(null, cuid, oldAuthorAccessID, newAuthorAccessID);
    });

    await db.updateLearningObjectAuthor(fromUserID, toUserID);

    updateSearchIndex(fromObjects, toObjects, newAuthor);

    updateLearningObjectReadMes(toObjects, event.authorizationToken);

    const response = {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*', // Required for CORS support to work
        },
    };
    
    callback(null, response);
};

/**
 * Sets up the connection to the elastic search domain index
 */
function setupElasticsearch() {
    return new Client({ node: process.env.ELASTIC_SEARCH_DOMAIN });
}

/**
 * Sets up the connection to the Clark AWS file bucket
 */
function setupAWS() {
    const AWS_SDK_CONFIG = {
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        },
        region: process.env.AWS_REGION
    };
    
    AWS.config.credentials = AWS_SDK_CONFIG.credentials;
    AWS.region = AWS_SDK_CONFIG.region;
    
    if (process.env.MODE === 'dev') {
        return new AWS.S3({ endpoint: `http://localhost:4566`, s3ForcePathStyle: true });
    } else {
        return new AWS.S3();
    }
}

/**
 * Copies files in s3 to location of new author
 * @param token token for multipart file uploads
 * @param fromCuid the cuid of the object to move
 * @param oldAuthorAccessID the file access id of the old author
 * @param newAuthorAccessID the file access id of the new author
 */
async function copyFiles(token, fromCuid, oldAuthorAccessID, newAuthorAccessID) {
    const s3Options = { Bucket: process.env.BUCKET_NAME, Prefix: `${oldAuthorAccessID.fileAccessId}/${fromCuid}` };
    if(token) {
        s3Options['ContinuationToken'] = token;
    }

    let allKeys = [];
    s3.listObjectsV2(s3Options, function(err, data) {
        allKeys = allKeys.concat(data.Contents);
    
        if(data.IsTruncated)
            copyFiles(data.NextContinuationToken, fromCuid, oldAuthorAccessID, newAuthorAccessID);
        else {
            allKeys.map(async key => {
                if (!key.Key.includes(`${fromCuid}.zip`)) {
                    await s3.copyObject({
                        Bucket: process.env.BUCKET_NAME,
                        CopySource: `${process.env.BUCKET_NAME}/${key.Key}`,  // old file Key
                        Key: `${newAuthorAccessID.fileAccessId}${key.Key.replace(oldAuthorAccessID.fileAccessId, '')}`, // new file Key
                    }).promise();
                }
            });
        }
    });
}


/**
 * Updates the search index in elastic to reflect author change
 * @param fromObjects objects that were changed
 * @param toObjects objects that are being added to
 * @param newAuthor the new author of the objects
 */
async function updateSearchIndex(fromObjects, toObjects, newAuthor) {
    const db = await MongoDB.getInstance();

    fromObjects.map(async learningObject => {
        const learningObjectID = learningObject._id;
        await deleteSearchIndexItem(learningObjectID);
    });

    toObjects.map(async learningObject => {
        let contributors = [];
        for(let j=0; j < learningObject.contributors.length; j++) {
            const author = await db.getUserAccount(learningObject.contributors[j]);
            contributors.push(author);
        }
        if(learningObject.outcomes !== undefined) {
            for(let p=0; p < learningObject.outcomes.length; p++) {
                learningObject.outcomes[p] = {...learningObject.outcomes[p], mappings: []};
            }
        } else {
            learningObject.outcomes = [];
        }
        await insertSearchIndexItem({ ...learningObject, author: newAuthor });
    });
}

/**
 * Deletes the search index of the object in elastic
 * @param learningObjectID the object id to delete
 */
async function deleteSearchIndexItem(learningObjectID) {
    try {
        await client.deleteByQuery({
            index: 'learning-objects',
            body: {
                query: {
                bool: {
                    must: [
                    {
                        match: { id: learningObjectID },
                    },
                    ],
                },
                },
            },
        });
    } catch (e) {
        console.error(e.meta.body.error);
    }
}

/**
 * Inserts new search index of a learning object into elastic
 * @param learningObject the object to add
 */
async function insertSearchIndexItem(learningObject) {
    try {
        await client.index({
            index: 'learning-objects',
            type: '_doc',
            body: formatLearningObjectSearchDocument(learningObject),
        });
    } catch (e) {
        console.error(e.meta.body.error);
    }
}

/**
 * Formats the object search document to the standardizattion we use in
 * elastic
 * @param learningObject the object to standardize
 */
function formatLearningObjectSearchDocument(
    learningObject,
  ) {
    const learningObjectSearchDocument = {
      author: {
        name: learningObject.author.name,
        username: learningObject.author.username,
        email: learningObject.author.email,
        organization: learningObject.author.organization,
      },
      collection: learningObject.collection,
      contributors: learningObject.contributors.map(c => ({
        name: c.name,
        username: c.username,
        email: c.email,
        organization: c.organization,
      })),
      date: learningObject.date,
      description: learningObject.description,
      cuid: learningObject.cuid,
      id: learningObject._id,
      length: learningObject.length,
      levels: learningObject.levels,
      name: learningObject.name,
      outcomes: learningObject.outcomes,
      version: learningObject.version,
      status: learningObject.status,
    };
    return learningObjectSearchDocument;
}

/**
 * Updates the learning object ReadMes to reflect the new author
 * change
 * @param toObjects The objects updated
 */
async function updateLearningObjectReadMes(toObjects, authToken) {
    toObjects.map(async learningObject => {
        const learningObjectID = learningObject._id;
        const options = {
            uri: `${process.env.LEARNING_OBJECT_API}/learning-objects/${learningObjectID}/pdf`,
            headers: {
                Authorization: authToken,
            },
            method: 'PATCH',
        };
        request(options);
    });
}