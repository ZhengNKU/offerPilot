import logging
import json
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

    【模板模式】腾讯云 SES 普通账户**仅支持模板发送**
    （Simple 字段已废弃：见 https://cloud.tencent.com/document/api/1288/51034 错误码 WithOutPermission）。

    使用流程：
      1. SES 控制台 → 发信模板 → 创建模板
         - 模板主题：面试VAR 验证码
         - 模板内容（HTML）：把验证码占位符写成 {{code}}
         - 创建后拿到 TemplateID（数字）
      2. 配置环境变量 TENCENT_SES_TEMPLATE_ID=<TemplateID>
      3. 代码调用 send_verification_code(email, code) 即可

    SDK 示例（示例2）：https://cloud.tencent.com/document/api/1288/51034
    """

    def __init__(self):
        self.secret_id = settings.TENCENT_SECRET_ID
        self.secret_key = settings.TENCENT_SECRET_KEY
        self.region = settings.TENCENT_SES_REGION or "ap-guangzhou"
        self.from_email = settings.TENCENT_SES_FROM_EMAIL
        self.from_name = settings.TENCENT_SES_FROM_NAME or "面试VAR"
        self.reply_to = settings.TENCENT_SES_REPLY_TO
        self.template_id = settings.TENCENT_SES_TEMPLATE_ID

    def send_verification_code(self, email: str, code: str) -> bool:
        """
        发送验证码邮件。如果 SES 配置缺失，则进行本地模拟发送并打印至控制台。
        """
        if not email or not _EMAIL_RE.match(email):
            logger.warning(f"邮箱格式无效，跳过发送: {email!r}")
            return False

        # 判定 SES 是否已就绪：秘钥 + 发件地址 + 模板ID 必须齐全
        if not all([self.secret_id, self.secret_key, self.from_email, self.template_id]):
            logger.warning(
                f"[DEVELOPMENT MODE] 腾讯云 SES 配置缺失"
                f"（需要 SECRET_ID / SECRET_KEY / FROM_EMAIL / TEMPLATE_ID）。"
                f"模拟发送验证码: 邮箱: {email}, 验证码: {code}"
            )
            print(
                f"\n========================================\n"
                f"[EMAIL DEV SIMULATION] 邮箱验证码已发送\n"
                f"邮箱: {email}\n"
                f"验证码: {code}\n"
                f"========================================\n"
            )
            return True

        try:
            cred = credential.Credential(self.secret_id, self.secret_key)
            client = ses_client.SesClient(cred, self.region)

            req = models.SendEmailRequest()
            # SES 要求 FromEmailAddress 必须是「已验证发信地址 / 发信域名」列表中的地址
            req.FromEmailAddress = self.from_email
            # Destination 在 SES SDK 里是 list[str]（最多 50 个收件人），不是对象
            req.Destination = [email]
            # Subject 即使使用模板模式也必须传（API 要求）
            # 模板主题里如有 {{变量}} 会被 TemplateData 替换
            req.Subject = "面试VAR 验证码"

            # 【模板模式】Simple 字段已废弃，普通账户只能通过模板发送
            req.Template = models.Template()
            req.Template.TemplateID = int(self.template_id)
            # TemplateData 是 JSON 字符串，变量名对应模板里的 {{key}}
            req.Template.TemplateData = json.dumps({"code": str(code)}, ensure_ascii=False)

            # Reply-To（可选）：让用户能回复到指定地址
            if self.reply_to:
                req.ReplyToAddresses = self.reply_to

            resp = client.SendEmail(req)
            logger.info(
                f"邮件已通过腾讯云 SES 投递至 {email}, "
                f"MessageId: {resp.MessageId}, RequestId: {resp.RequestId}"
            )
            return True

        except TencentCloudSDKException as e:
            logger.exception(
                f"调用腾讯云 SES 发送邮件失败: code={e.code}, message={e.message}"
            )
            return False
        except Exception:
            logger.exception("调用腾讯云 SES 发送邮件时发生未预期异常")
            return False


email_helper = EmailHelper()
