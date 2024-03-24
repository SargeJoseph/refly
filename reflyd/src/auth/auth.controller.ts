import {
  Controller,
  Logger,
  Get,
  Post,
  Res,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { User } from '@prisma/client';
import { LocalAuthGuard } from './guard/local-auth.guard';
import { JwtAuthGuard } from './guard/jwt-auth.guard';
import { GithubOauthGuard } from './guard/github-oauth.guard';
import { GoogleOauthGuard } from './guard/google-oauth.guard';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {}

  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Request() req) {
    return this.authService.login(req.user);
  }

  @UseGuards(GithubOauthGuard)
  @Get('github')
  async github() {
    // guard 自动处理
  }

  @UseGuards(GoogleOauthGuard)
  @Get('google')
  async google() {
    // guard 自动处理
  }

  @UseGuards(GithubOauthGuard)
  @Get('callback')
  async githubAuthCallback(@Request() req, @Res() res: Response) {
    const user = req.user as User;

    this.logger.log(
      `github oauth callback success, req.user = ${JSON.stringify(user)}`,
    );

    const { accessToken } = await this.authService.login(user);
    res
      .cookie(this.configService.get('auth.cookieTokenField'), accessToken, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
      })
      .redirect(this.configService.get('auth.redirectUrl'));
  }

  @UseGuards(GoogleOauthGuard)
  @Get('callback/google')
  async googleAuthCallback(@Request() req, @Res() res: Response) {
    const user = req.user as User;

    this.logger.log(
      `google oauth callback success, req.user = ${JSON.stringify(user)}`,
    );

    const { accessToken } = await this.authService.login(user);
    res
      .cookie(this.configService.get('auth.cookieTokenField'), accessToken, {
        domain: this.configService.get('auth.cookieDomain'),
      })
      .redirect(this.configService.get('auth.redirectUrl'));
  }

  @UseGuards(JwtAuthGuard)
  @Get('getUserInfo')
  getUserInfo(@Request() req) {
    return req.user;
  }
}
