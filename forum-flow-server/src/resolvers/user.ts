//User Entity
import { User } from '../entities/User';
//MyContext defines the data types for request, response and session coming from the server, as well as redis
import { MyContext } from 'src/types';
//used to encrypt and decrypt passwords
import argon2 from 'argon2';
//function used by graphql to transform the database
import {
  Resolver,
  Query,
  Mutation,
  Field,
  Arg,
  Ctx,
  ObjectType,
  FieldResolver,
  Root,
} from 'type-graphql';
import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from '../constants';
import { UsernamePasswordInput } from './UsernamePasswordInput';
import { validateRegister } from '../utils/validateRegister';
import { sendEmail } from '../utils/sendEmail';
//The uuid, or universally unique identifier, npm package is a secure way to generate cryptographically strong unique identifiers
import { v4 } from 'uuid';
//FieldError displays the field ie(username, password) and the error message if the errors field returns true
@ObjectType()
class FieldError {
  @Field()
  field: string;
  @Field()
  message: string;
}
//UserResponse is used when the end user registers. This ObjectType returns the user if the password and username fields are inputted correctly
//If either of these fields are not completed correctly the FieldError ObjectType will be used
@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => User, { nullable: true })
  user?: User;
}
//The UserResolver is used register and login users of the application
//the changePassword mutation takes the token provided by the server and users new password input
//and changes the users password
@Resolver(User)
export class UserResolver {
  @FieldResolver(() => String)
  email(@Root() user: User, @Ctx() { req }: MyContext) {
    //this is the current user and its ok to show them their own email
    if (req.session.userId === user._id) {
      return user.email;
    }
    //current user wants to see someone elses email
    return '';
  }
  @Mutation(() => UserResponse)
  async changePassword(
    @Arg('token') token: string,
    @Arg('newPassword') newPassword: string,
    @Ctx() { redis, req }: MyContext
  ): Promise<UserResponse> {
    if (newPassword.length <= 2) {
      return {
        errors: [
          { field: 'newPassword', message: 'length must be greater than 2' },
        ],
      };
    }
    //key constant provides the token
    const key = FORGET_PASSWORD_PREFIX + token;
    //redis finds the matching token in cache
    const userId = await redis.get(key);
    if (!userId) {
      return {
        errors: [{ field: 'token', message: 'token expired' }],
      };
    }
    //finds the user by comparing the userId paired with the token to the userId's in the Users table
    const userIdNum = parseInt(userId);
    const user = await User.findOne(userIdNum);

    if (!user) {
      return {
        errors: [{ field: 'token', message: 'user no longer exist' }],
      };
    }
    //users password is updated with the new password using argon to hash the password
    await User.update(
      { _id: userIdNum },
      {
        password: await argon2.hash(newPassword),
      }
    );
    //updates are added to the database
    //deletes the token so it cannot be used again after the user has changed their password
    await redis.del(key);
    //log in user after changing password
    req.session.userId = user._id;

    return { user };
  }
  //the forgotPassword mutation takes the email provided by the user and finds the users information within the Users table
  //once the user is found redis will take the token created by uuid and pair it with the  user's id number and set it in cache with a 3 day expiration period
  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg('email') email: string,
    @Ctx() { redis }: MyContext
  ) {
    //find the user by comparing emails
    const user = await User.findOne({ where: { email } });
    if (!user) {
      //the email is not in the database
      return true;
    }

    //uuid created a unique identifier
    const token = v4();
    //redis pairs the user's id with the unique identifier generated by uuid and set then in cache with a 3 day expiration period
    await redis.set(
      FORGET_PASSWORD_PREFIX + token,
      user._id,
      'ex',
      1000 * 60 * 60 * 24 * 3
    ); // 3 days to reset their password

    //email is sent to the user with a link routing them to the change password page.
    await sendEmail(
      email,
      `<a href="${process.env.CORS_ORIGIN}/change-password/${token}">reset password</a>`
    );

    return true;
  }

  @Query(() => User, { nullable: true })
  async me(@Ctx() { req }: MyContext) {
    // you are not logged in
    if (!req.session.userId) {
      return null;
    }
    return User.findOne(req.session.userId);
  }
  //the register mutation adds new users to the Users table. If the users username or password is not greater than 2 then an error message will return
  //otherwise the register mutation will return the newly created user object
  @Mutation(() => UserResponse)
  async register(
    @Arg('options') options: UsernamePasswordInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    // validateRegister makes sure the values entered by the end user on the registration page meets a set of standards
    const errors = validateRegister(options);
    if (errors) {
      return { errors };
    }
    //argon2.hash is used to hash the password provided but the user.
    const hashedPassword = await argon2.hash(options.password);
    let user: any;
    try {
      //result creates a new user
      const result = await User.create({
        username: options.username,
        email: options.email,
        password: hashedPassword,
      }).save();
      // const result = await getConnection()
      //   .createQueryBuilder()
      //   .insert()
      //   .into(User)
      //   .values({
      //     username: options.username,
      //     email: options.email,
      //     password: hashedPassword,
      //   })
      //   .returning('*')
      // .execute();
      user = result;
    } catch (err) {
      console.log('error: ', err);
      //duplicate username error
      if (err.code === '23505') {
        return {
          errors: [{ field: 'username', message: 'username already exists' }],
        };
      }
    }
    //store user id session
    //this will set a cookie on the user
    //keep them logged in
    req.session.userId = user._id;

    return { user };
  }
  //the login mutation adds logs users in by first finding the username in the Users table. Once the user name is found it compares the passwords using argon2. If the users username or password are not correct an error message will return
  @Mutation(() => UserResponse)
  async login(
    @Arg('usernameOrEmail') usernameOrEmail: string,
    @Arg('password') password: string,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    //em.findOne is used by MikroOrm to find the user in the User table that has a matching username.
    const user = await User.findOne(
      usernameOrEmail.includes('@')
        ? { where: { email: usernameOrEmail } }
        : { where: { username: usernameOrEmail } }
    );
    if (!user) {
      return {
        errors: [
          {
            field: 'usernameOrEmail',
            message: "that username doesn't exist",
          },
        ],
      };
    }
    //argon2.verify compares the hash password to the password provided by the user
    const valid = await argon2.verify(user.password, password);
    if (!valid) {
      return {
        errors: [
          {
            field: 'password',
            message: 'incorrect password',
          },
        ],
      };
    }
    //Assigns the userId for this session to the user._id of the logged in user.
    //store user id session
    //this will set a cookie on the user
    //keep them logged in
    req.session.userId = user._id;

    return { user };
  }
  //the logout mutation logs the user out by clearing the cookie
  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) =>
      //removes the session cookie which initiates the MeQuery
      //The MeQuery will return null which logs the user out.
      req.session.destroy((err) => {
        res.clearCookie(COOKIE_NAME);
        if (err) {
          console.log(err);
          resolve(false);
          return;
        } else {
          resolve(true);
        }
      })
    );
  }
}
