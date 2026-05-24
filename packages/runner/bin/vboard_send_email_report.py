#!/usr/bin/env python3
import argparse
import email.message
import smtplib
import subprocess
import tomllib
from pathlib import Path
from email.utils import formatdate, make_msgid

CONFIG = Path('/data/.config/himalaya/config.toml')

def cfg_get(d, path, default=None):
    cur = d
    for part in path.split('.'):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur

def password_from_auth(auth):
    cmd = auth.get('cmd') if isinstance(auth, dict) else None
    if not cmd:
        raise RuntimeError('SMTP_AUTH_CMD_MISSING')
    if isinstance(cmd, str):
        result = subprocess.run(cmd, shell=True, check=True, text=True, capture_output=True, timeout=20)
    elif isinstance(cmd, list):
        result = subprocess.run(cmd, check=True, text=True, capture_output=True, timeout=20)
    else:
        raise RuntimeError('SMTP_AUTH_CMD_INVALID')
    password = result.stdout.strip()
    if not password:
        raise RuntimeError('SMTP_AUTH_EMPTY')
    return password

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--to', required=True)
    ap.add_argument('--subject', required=True)
    ap.add_argument('--body-file', required=True)
    args = ap.parse_args()

    data = tomllib.loads(CONFIG.read_text())
    account = data['accounts']['default']
    sender = account['email']
    display = account.get('display-name', sender)
    smtp_cfg = account['message']['send']['backend']
    auth = smtp_cfg.get('auth', {})
    password = password_from_auth(auth)

    msg = email.message.EmailMessage()
    msg['From'] = f'{display} <{sender}>'
    msg['To'] = args.to
    msg['Subject'] = args.subject
    msg['Date'] = formatdate(localtime=False)
    msg['Message-ID'] = make_msgid(domain='vboardlabs.business')
    msg.set_content(Path(args.body_file).read_text(), subtype='plain', charset='utf-8')

    host = smtp_cfg['host']
    port = int(smtp_cfg.get('port', 465))
    login = smtp_cfg.get('login', sender)
    with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
        smtp.login(login, password)
        smtp.send_message(msg)
    print('EMAIL_SENT')

if __name__ == '__main__':
    main()
