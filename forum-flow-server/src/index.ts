import 'reflect-metadata';
//Importing MikroORM - A typescript ORM used to query data from the AWS Postgres database
import { MikroORM } from '@mikro-orm/core';
//Importing configuration data needed to initialize MikroOrm
import microConfig from './mikro-orm.config';
import { Post } from './entities/Post';
//server framework used to build JSON APIs
import express from 'express';
// Apollo Server is open-source GraphQL server that works with many Node.js HTTP server frameworks
//provides an way to build a production-ready, self-documenting GraphQL APIs
import { ApolloServer } from 'apollo-server-express';
//buildSchema defines the entities that exist but also the different queries and mutations that are possible to make
//it also includes resolvers which are functions that are invoked when the user makes a query or mutation
import { buildSchema } from 'type-graphql';
import { HelloResolver } from './resolvers/hello';
//PostResolver is used query or mutate the Post table
import { PostResolver } from './resolvers/post';
//UserResolver is used query or mutate the Users table
import { UserResolver } from './resolvers/user';
//__prod__ is used to notify the server when the application is in production mode
import { __prod__ } from './constants';
import { MyContext } from './types';
//used to revert the Apollo Server GUI to the previous version
import { ApolloServerPluginLandingPageGraphQLPlayground } from 'apollo-server-core';
import cors from 'cors';

//Async statement used to connect MikroORM to my Postgres database
const main = async () => {
  const orm = await MikroORM.init(microConfig);
  //getMigrator().up() runs the migrations once MikroORM is initiated
  await orm.getMigrator().up();

  const app = express();

  app.set('trust proxy', 1);

  app.use(cors());
  //It's an open source tool that runs as a service in the background that allows you to store data in memory for high-performance data retrieval and storage
  //Redis will be used in this application as a cache to store frequently accessed data in memory i.e(sessions).
  const redis = require('ioredis');
  //When the client makes a login request to the server, the server will create a session and store it on the server-side.
  //When the server responds to the client, it sends a cookie.
  //This cookie will contain the session’s unique id stored on the server, which will now be stored on the client.
  const session = require('express-session');
  //RedisStore connects Redis to the session created by the server
  //This allows Redis to now store the session in cache
  let RedisStore = require('connect-redis')(session);
  //redisClient creates a new client connection to Redis
  let redisClient = redis.createClient();
  //The two following checks to see if Redis is connected or not
  redisClient.on('error', function (error) {
    console.error('Error encountered: ', error);
  });
  redisClient.on('connect', function (error) {
    console.error('Redis connecton establised');
  });
  //Server created a session through Apollo Server
  app.use(
    session({
      name: 'qid',
      store: new RedisStore({ client: redisClient, disableTouch: true }),
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 365 * 10, // 10 years
        httpOnly: true,
        sameSite: 'lax', // csrf
        secure: __prod__, // cookie only works in https
      },
      saveUninitialized: false,
      secret: 'dsdsfdsfdsfksdfjksa',
      resave: false,
    })
  );
  //Apollo server creates a schema for queries, mutations, and resolvers
  const apolloServer = new ApolloServer({
    schema: await buildSchema({
      resolvers: [HelloResolver, PostResolver, UserResolver],
      validate: false,
    }),
    context: ({ req, res }): MyContext => ({ em: orm.em, req, res }),
    //This plugin reverts back to the graphql playground to allow cookies to be passed between the server and the client
    plugins: [
      ApolloServerPluginLandingPageGraphQLPlayground({
        settings: { 'request.credentials': 'include' },
      }),
    ],
  });
  //This following function start apollo server and applies the needed middleware
  await apolloServer.start();
  apolloServer.applyMiddleware({ app });
  //The server listens for traffic on port 4000
  app.listen(4000, () => {
    console.log('server started on localhost:4000');
  });
};
//the async function initializes the server and redis
main();