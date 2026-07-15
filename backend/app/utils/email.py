import logging
import html
import re
from app.config import settings
from tencentcloud.common import credential
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.ses.v20201002 import ses_client, models

logger = logging.getLogger(__name__)

# 简单的邮箱格式校验，足以拦住明显错误；不做 MX 校验
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class EmailHelper:
    """
    验证码邮件发送器：基于腾讯云 SES（邮件推送）SendEmail 接口。
    SDK: tencentcloud-sdk-python ≥ 3.x，包含 tencentcloud.ses.v20201002 子模块。
    复用全局 TENCENT_SECRET_ID / TENCENT_SECRET_KEY（与 SMS 同源）。
    文档：https://cloud.tencent.com/document/api/1288/51034
    """

    def __init__(self):
        self.secret_id = settings.TENCENT_SECRET_ID
        self.secret_key = settings.TENCENT_SECRET_KEY
        self.region = settings.TENCENT_SES_REGION or "ap-hongkong"
        self.from_email = settings.TENCENT_SES_FROM_EMAIL
        self.from_name = settings.TENCENT_SES_FROM_NAME or "面试VAR"
        self.reply_to = settings.TENCENT_SES_REPLY_TO

    def send_verification_code(self, email: str, code: str) -> bool:
        """
        发送验证码邮件。如果 SES 配置缺失，则进行本地模拟发送并打印至控制台。
        """
        if not email or not _EMAIL_RE.match(email):
            logger.warning(f"邮箱格式无效，跳过发送: {email!r}")
            return False

        # 判定 SES 是否已就绪：秘钥 + 发件地址 必须齐全
        if not all([self.secret_id, self.secret_key, self.from_email]):
            # 配置不完整时本地开发模拟发送，打印到日志，方便本地调试
            logger.warning(
                f"[DEVELOPMENT MODE] 腾讯云 SES 配置缺失。模拟发送验证码: "
                f"邮箱: {email}, 验证码: {code}"
            )
            print(
                f"\n========================================\n"
                f"[EMAIL DEV SIMULATION] 邮箱验证码已发送\n"
                f"邮箱: {email}\n"
                f"验证码: {code}\n"
                f"========================================\n"
            )
            return True

        # 防 XSS：把验证码做 HTML escape 再塞进模板
        safe_code = html.escape(str(code))
        subject = "面试VAR 验证码"

        content = f"""
        <html>
        <body style="margin: 0; padding: 0; background-color: #050B1A; -webkit-text-size-adjust: none; text-size-adjust: none;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #050B1A; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px 20px;">
                <tr>
                    <td align="center" style="vertical-align: top;">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; background: linear-gradient(135deg, #09132C 0%, #060E20 100%); border: 1px solid rgba(175, 167, 255, 0.15); border-radius: 24px; padding: 32px; text-align: left; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
                            <!-- Header Logo Section -->
                            <tr>
                                <td style="padding-bottom: 20px;">
                                    <table border="0" cellpadding="0" cellspacing="0">
                                        <tr>
                                            <td style="vertical-align: middle; padding-right: 12px; width: 40px; height: 40px;">
                                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block;">
                                                    <path d="M12 2L20 7V17L12 22L4 17V7L12 2ZM12 6L16 11H13V18L12 18L11 18V13H8L12 6Z" fill-rule="evenodd" clip-rule="evenodd" fill="url(#nav-brand-logo-email)" />
                                                    <defs>
                                                        <linearGradient id="nav-brand-logo-email" x1="0" y1="0" x2="1" y2="1">
                                                            <stop offset="0%" stop-color="#c0c1ff" />
                                                            <stop offset="100%" stop-color="#ffb2b7" />
                                                        </linearGradient>
                                                    </defs>
                                                </svg>
                                            </td>
                                            <td style="vertical-align: middle;">
                                                <span style="font-size: 22px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.5px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; display: block; line-height: 1.1;">面试VAR</span>
                                                <span style="font-size: 10px; font-weight: bold; color: #5DECCB; letter-spacing: 1px; text-transform: uppercase; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; display: block; margin-top: 2px;">AI Interview Coach</span>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <!-- Divider -->
                            <tr>
                                <td style="height: 1px; background: linear-gradient(90deg, rgba(175, 167, 255, 0.25) 0%, rgba(175, 167, 255, 0) 100%); padding: 0;"></td>
                            </tr>
                            <!-- Greeting & Intro -->
                            <tr>
                                <td style="padding-top: 24px; padding-bottom: 16px;">
                                    <h3 style="font-size: 18px; font-weight: 800; color: #FFFFFF; margin: 0 0 12px 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">验证您的邮箱地址</h3>
                                    <p style="font-size: 14px; color: #A4B3E6; line-height: 1.6; margin: 0 0 24px 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                                        您好！感谢您选择 <strong>面试VAR AI 面试教练</strong>。您正在进行账号的安全验证操作，请在验证输入框中填写以下验证码：
                                    </p>
                                </td>
                            </tr>
                            <!-- Verification Code Card -->
                            <tr>
                                <td style="padding-bottom: 24px;">
                                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: rgba(175, 167, 255, 0.06); border: 1px dashed rgba(175, 167, 255, 0.25); border-radius: 16px; padding: 20px; text-align: center;">
                                        <tr>
                                            <td>
                                                <span style="display: block; font-size: 12px; color: #AFA7FF; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">验证码 (5分钟内有效)</span>
                                                <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 900; color: #FFFFFF; letter-spacing: 6px; text-shadow: 0 0 10px rgba(175,167,255,0.3);">{safe_code}</span>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <!-- Notice -->
                            <tr>
                                <td style="padding-bottom: 24px;">
                                    <p style="font-size: 12px; color: #64748B; line-height: 1.6; margin: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                                        如果您本人未发起此项申请，请忽略此邮件。为了您的账号安全，请勿将验证码泄露给他人。
                                    </p>
                                </td>
                            </tr>
                            <!-- Divider -->
                            <tr>
                                <td style="height: 1px; background: rgba(255, 255, 255, 0.06); padding: 0;"></td>
                            </tr>
                            <!-- Footer -->
                            <tr>
                                <td style="padding-top: 20px; text-align: center;">
                                    <p style="font-size: 11px; color: #475569; margin: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                                        © 2026 面试VAR AI. All rights reserved.
                                    </p>
                                    <p style="font-size: 11px; color: #475569; margin: 4px 0 0 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                                        让每一次面试都成为下一次 Offer 的养料。
                                    </p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        """

        plain_text = (
            f"面试VAR 验证码\n\n"
            f"您好！感谢您选择 面试VAR。\n"
            f"您正在进行账号的安全验证操作，请在验证输入框中填写以下验证码：\n\n"
            f"    {code}\n\n"
            f"验证码 5 分钟内有效。\n"
            f"如果您本人未发起此项申请，请忽略此邮件。为了您的账号安全，请勿将验证码泄露给他人。\n\n"
            f"© 2026 面试VAR AI. All rights reserved.\n"
            f"让每一次面试都成为下一次 Offer 的养料。"
        )

        try:
            cred = credential.Credential(self.secret_id, self.secret_key)
            client = ses_client.SesClient(cred, self.region)

            req = models.SendEmailRequest()
            # SES 要求 FromEmailAddress 必须是"已验证发信地址 / 发信域名"列表中的地址
            req.FromEmailAddress = self.from_email
            req.Destination.ToAddresses = [email]
            req.Subject = subject
            req.Content = content      # HTML 正文
            req.Simple = plain_text    # 纯文本 fallback（部分客户端会用到）

            # 网易 / QQ / Outlook 主流邮箱对 SES 的代发没有强 SPF 问题，
            # 但仍建议配置 reply-to 以便收件人回复。
            if self.reply_to:
                req.ReplyToAddresses = self.reply_to

            resp = client.SendEmail(req)
            # SendEmail 成功时返回 MessageId；失败时抛 TencentCloudSDKException
            logger.info(
                f"邮件已通过腾讯云 SES 投递至 {email}, MessageId: {resp.MessageId}, RequestId: {resp.RequestId}"
            )
            return True

        except TencentCloudSDKException as e:
            logger.exception(f"调用腾讯云 SES 发送邮件失败: code={e.code}, message={e.message}")
            return False
        except Exception as e:
            logger.exception("调用腾讯云 SES 发送邮件时发生未预期异常")
            return False


email_helper = EmailHelper()