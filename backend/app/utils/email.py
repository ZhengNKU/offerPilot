import os
import shutil
import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from email.header import Header
from app.config import settings

logger = logging.getLogger(__name__)

# Run-time dynamic helper to copy generated logo.png to workspace if it is missing
def setup_logo_assets():
    try:
        # Resolve target logo paths
        backend_logo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        backend_logo_path = os.path.join(backend_logo_dir, "logo.png")
        
        root_dir = os.path.dirname(backend_logo_dir)
        frontend_logo_path = os.path.join(root_dir, "frontend", "public", "logo.png")
        
        # Source artifact path generated previously by agent
        source_logo_path = r"C:\Users\47181\.gemini\antigravity\brain\3c0cc75d-9a15-4309-b18f-41662f947071\offerpilot_logo_1780723456649.png"
        
        if os.path.exists(source_logo_path):
            if not os.path.exists(backend_logo_path):
                shutil.copy(source_logo_path, backend_logo_path)
                logger.info(f"Copied logo to backend: {backend_logo_path}")
            
            # Ensure target frontend directory exists
            frontend_dir = os.path.dirname(frontend_logo_path)
            if os.path.exists(frontend_dir) and not os.path.exists(frontend_logo_path):
                shutil.copy(source_logo_path, frontend_logo_path)
                logger.info(f"Copied logo to frontend: {frontend_logo_path}")
    except Exception as e:
        logger.warning(f"Failed to auto-setup logo assets: {e}")

# Run setup
setup_logo_assets()


class EmailHelper:
    def __init__(self):
        self.host = settings.SMTP_HOST
        self.port = settings.SMTP_PORT
        self.user = settings.SMTP_USER
        self.password = settings.SMTP_PASSWORD
        self.sender = settings.SMTP_SENDER or settings.SMTP_USER
        self.use_ssl = settings.SMTP_USE_SSL

    def send_verification_code(self, email: str, code: str) -> bool:
        """
        发送验证码邮件。如果 SMTP 配置缺失，则进行本地模拟发送并打印至控制台。
        """
        if not all([self.host, self.port, self.user, self.password]):
            # SMTP配置不完整时，本地开发进行模拟，打印到日志，方便本地调试
            logger.warning(f"[DEVELOPMENT MODE] 邮箱 SMTP 配置缺失。模拟发送验证码: 邮箱: {email}, 验证码: {code}")
            print(f"\n========================================\n[EMAIL DEV SIMULATION] 邮箱验证码已发送\n邮箱: {email}\n验证码: {code}\n========================================\n")
            return True

        try:
            subject = "面试VAR 验证码"
            
            # Use CID image reference for logo
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
                                                    <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 900; color: #FFFFFF; letter-spacing: 6px; text-shadow: 0 0 10px rgba(175,167,255,0.3);">{code}</span>
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
            
            # Construct alternative multipart message (no attachments/related parts)
            message = MIMEMultipart("alternative")
            message["From"] = Header(f"面试VAR <{self.sender}>", "utf-8")
            message["To"] = Header(email, "utf-8")
            message["Subject"] = Header(subject, "utf-8")
            
            # Plain-text alternative must come first (RFC 2046 order)
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
            msg_plain = MIMEText(plain_text, "plain", "utf-8")
            message.attach(msg_plain)

            msg_html = MIMEText(content, "html", "utf-8")
            message.attach(msg_html)

            # SMTP Connection
            if self.use_ssl:
                server = smtplib.SMTP_SSL(self.host, self.port, timeout=10)
            else:
                server = smtplib.SMTP(self.host, self.port, timeout=10)
                server.starttls()

            server.login(self.user, self.password)
            server.sendmail(self.sender, [email], message.as_string())
            server.quit()
            logger.info(f"邮件成功发送至 {email}")
            return True
        except Exception as e:
            logger.exception("调用 SMTP 发送邮件时发生异常")
            return False

email_helper = EmailHelper()
