# Hyper-V Management Panel

A modern, full-featured web-based management panel for Microsoft Hyper-V virtualization platform. Built with React, Node.js, and PowerShell integration.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![React](https://img.shields.io/badge/react-18.x-blue.svg)

## 🚀 Features

### Virtual Machine Management
- ✅ **Full VM Control** - Start, stop, restart, suspend, and resume VMs
- ✅ **Real-time Monitoring** - CPU, memory, disk, and network usage
- ✅ **Snapshot Management** - Create, restore, and delete VM snapshots
- ✅ **ISO Library** - Mount and unmount ISO files
- ✅ **VM Creation Wizard** - Create new VMs with custom specifications
- ✅ **RDP/Console Access** - Direct VM console access via browser
- ✅ **Password Reset** - Reset Windows passwords (guest and emergency offline methods)

### User & Access Control
- 🔐 **Role-Based Access** - Admin, User, and Viewer roles
- 🔐 **JWT Authentication** - Secure token-based auth with refresh tokens
- 🔐 **2FA Support** - TOTP-based two-factor authentication
- 🔐 **Session Management** - View and revoke active sessions
- 🔐 **VM-Level Permissions** - Assign specific VMs to users
- 🔐 **Discord Integration** - OAuth login and whitelist support
- 🔐 **Brute Force Protection** - Rate limiting and lockout mechanisms

### Advanced Features
- 📊 **Bandwidth Monitoring** - Track network usage over time
- 🚨 **Alert System** - CPU/memory/status alerts via email/webhook
- 🛡️ **DDoS Protection** - Automatic detection and mitigation of outbound attacks
- 👥 **Client Management** - Track clients, billing, and VM assignments
- 📝 **Audit Logging** - Comprehensive action logging with user tracking
- 🔍 **Security Dashboard** - Login attempts, risk events, and session monitoring

### Developer Features
- 🎨 **Modern UI** - Dark theme with Tailwind CSS
- 🔄 **Real-time Updates** - Auto-refresh VM status
- 📱 **Responsive Design** - Works on desktop and mobile
- 🌐 **RESTful API** - Well-documented backend API
- ⚡ **Performance** - VM caching for fast page loads
- 🛠️ **Extensible** - Modular architecture for easy customization

---

## 📋 Prerequisites

### Server Requirements
- **Windows Server** 2016 or newer (with Hyper-V role installed)
- **Node.js** 18.x or newer
- **MySQL** 5.7 or newer (or MariaDB 10.3+)
- **PowerShell** 5.1 or newer
- **Administrator privileges** for Hyper-V management

### Client Requirements
- Modern web browser (Chrome, Firefox, Edge, Safari)
- JavaScript enabled

---

## 🔧 Installation

### 1. Clone the Repository

```bash
git clone [https://github.com/yourusername/hyperv-panel.git](https://github.com/laggis/Hyperv-Control-Panel.git)
cd hyperv-panel
```

### 2. Database Setup

**Create MySQL Database:**

```sql
CREATE DATABASE hyperv_panel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hyperv_panel'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON hyperv_panel.* TO 'hyperv_panel'@'localhost';
FLUSH PRIVILEGES;
```

### 3. Backend Setup

```bash
cd backend
npm install
```

**Configure Environment Variables:**

Copy the example `.env` file and edit it:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Server
PORT=3001
NODE_ENV=production

# MySQL Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=hyperv_panel
DB_PASSWORD=your_secure_password
DB_NAME=hyperv_panel

# JWT (generate secure random strings)
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES=604800

# PowerShell
PS_EXECUTION_POLICY=Bypass

# VM root paths (semicolon-separated Windows paths)
VM_ROOTS=C:\Vms;D:\HyperV\Virtual Machines

# Default admin user
DEFAULT_ADMIN_USER=admin
```

**First Run:**

```bash
node server.js
```

The system will:
- Create all database tables automatically
- Generate a random admin password (printed to console)
- **⚠️ IMPORTANT:** Copy the admin password immediately - it won't be shown again!

### 4. Frontend Setup

```bash
cd ../frontend
npm install
npm run build
```

The built frontend will be served by the backend in production mode.

---

## 🚀 Running the Application

### Production Mode

```bash
cd backend
node server.js
```

Access the panel at: `http://your-server:3001`

### Development Mode

**Backend:**
```bash
cd backend
npm run dev  # or: node server.js
```

**Frontend (separate terminal):**
```bash
cd frontend
npm run dev
```

Access:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

---

## 📖 Usage Guide

### First Login

1. Navigate to `http://your-server:3001`
2. Login with the admin credentials from first run
3. **Change the admin password immediately** (Security → Change Password)

### Creating Users

1. Go to **Users** page
2. Click **New User**
3. Set username, password, and role
4. Optionally assign VMs
5. Click **Create**

### Managing VMs

**View VMs:**
- Navigate to **Virtual Machines** page
- See real-time status of all VMs

**Control VM:**
- Click on a VM to see details
- Use action buttons: Start, Stop, Restart, Suspend, Resume
- Create snapshots for backup

**Assign VM to User:**
1. Go to **Users** page
2. Click **Assign VMs** for a user
3. Select VMs from the list
4. Click **Save**

### Setting Up Alerts

1. Go to **Alerts** page
2. Click **New Rule**
3. Configure:
   - Metric (CPU, Memory, VM Status)
   - Threshold
   - Email/Webhook notifications
4. Click **Create Rule**

### DDoS Protection

1. Go to **DDoS Protection** page
2. Click **Configure**
3. Set:
   - Detection thresholds (MB/s)
   - Alert email/webhook
   - Auto-actions (optional)
4. Click **Save Configuration**

The system monitors all VMs every 60 seconds and alerts you of suspicious traffic.

---

## 🔒 Security Best Practices

### Essential Security Steps

1. **Change Default Admin Password** - Immediately after first login
2. **Use Strong JWT Secret** - Generate a secure random string (32+ characters)
3. **Enable 2FA** - For admin accounts (Security page)
4. **Configure HTTPS** - Use a reverse proxy (nginx/IIS) with SSL certificate
5. **Restrict Network Access** - Use firewall rules to limit access
6. **Regular Backups** - Backup MySQL database regularly
7. **Update Dependencies** - Keep Node.js packages up to date
8. **Review Audit Logs** - Check logs regularly for suspicious activity

### Recommended nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name hyperv.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 🛠️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `3001` |
| `NODE_ENV` | Environment (development/production) | `development` |
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL username | `hyperv_panel` |
| `DB_PASSWORD` | MySQL password | - |
| `DB_NAME` | MySQL database name | `hyperv_panel` |
| `JWT_SECRET` | Secret for JWT signing | Required |
| `JWT_EXPIRES_IN` | JWT expiry time | `15m` |
| `REFRESH_TOKEN_EXPIRES` | Refresh token expiry (seconds) | `604800` |
| `VM_ROOTS` | Semicolon-separated VM root paths | - |
| `PS_EXECUTION_POLICY` | PowerShell execution policy | `Bypass` |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost:5173` |
| `DEFAULT_ADMIN_USER` | Default admin username | `admin` |

### VM Root Paths

The `VM_ROOTS` setting controls which VMs are visible in the panel. Only VMs whose files (config, VHD, etc.) are located under these paths will be shown (unless `show_all_vms` is enabled).

Example:
```env
VM_ROOTS=C:\Vms;D:\HyperV\Virtual Machines;E:\Production
```

To show all VMs regardless of location, set in database:
```sql
UPDATE settings SET value = '1' WHERE `key` = 'show_all_vms';
```

---

## 📡 API Documentation

### Authentication

All API endpoints (except `/auth/login`) require a JWT token:

```bash
Authorization: Bearer <your_jwt_token>
```

### Key Endpoints

**Authentication:**
- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout and revoke session
- `GET /api/auth/me` - Get current user info

**Virtual Machines:**
- `GET /api/vms` - List all VMs
- `GET /api/vms/:name` - Get VM details
- `POST /api/vms/:name/start` - Start VM
- `POST /api/vms/:name/stop` - Stop VM
- `POST /api/vms/:name/restart` - Restart VM

**Users (Admin only):**
- `GET /api/auth/users` - List all users
- `POST /api/auth/users` - Create user
- `DELETE /api/auth/users/:id` - Delete user
- `PUT /api/auth/users/:id/password` - Change password

**Alerts:**
- `GET /api/alerts` - List alert rules
- `POST /api/alerts` - Create alert rule
- `GET /api/alerts/events` - List recent alert events

**DDoS Protection:**
- `GET /api/ddos/events` - Get DDoS events
- `GET /api/ddos/stats` - Get statistics
- `GET /api/ddos/config` - Get configuration
- `PUT /api/ddos/config` - Update configuration

Full API documentation: See `API.md` for complete endpoint reference.

---

## 🔍 Troubleshooting

### Common Issues

**Backend won't start:**
- Check MySQL is running and accessible
- Verify database credentials in `.env`
- Check if port 3001 is available
- Review console logs for errors

**Can't see any VMs:**
- Verify Hyper-V is installed and running
- Check `VM_ROOTS` paths in `.env`
- Set `show_all_vms = 1` in database to bypass filtering
- Ensure backend is running as Administrator
- Check PowerShell execution policy

**Authentication fails:**
- Verify JWT_SECRET is set in `.env`
- Check MySQL users table for user account
- Try password reset script: `node scripts/reset-password.js`
- Clear browser cache and cookies

**VMs not responding to commands:**
- Verify user has permissions for the VM
- Check Windows Event Viewer for Hyper-V errors
- Ensure Hyper-V Management service is running
- Review backend logs for PowerShell errors

**Frontend shows white screen:**
- Rebuild frontend: `cd frontend && npm run build`
- Clear browser cache (Ctrl+Shift+R)
- Check browser console for errors (F12)
- Verify `NODE_ENV=production` in backend `.env`

### Debug Mode

Enable detailed logging:

```bash
# Backend - check console output
node server.js

# View specific route logs
# Check for [filterVmList] or [ddos] prefixed messages
```

**Check VM filtering:**
```
GET /api/vms/debug-filter
```

This shows all VMs, paths, and why each is included/excluded.

---

## 📁 Project Structure

```
hyperv-panel/
├── backend/
│   ├── middleware/          # Auth, audit logging
│   ├── routes/              # API endpoints
│   ├── utils/               # Database, PowerShell, monitoring
│   ├── scripts/             # Utility scripts (password reset, etc.)
│   ├── server.js            # Main server file
│   └── .env                 # Configuration
├── frontend/
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Page components
│   │   ├── hooks/           # React hooks
│   │   ├── api.js           # API client
│   │   └── main.jsx         # App entry point
│   ├── dist/                # Production build output
│   └── vite.config.js       # Vite configuration
└── README.md                # This file
```

---

## 🧪 Testing

### Quick Test

```bash
cd backend
node scripts/quick-test.js
```

### Full Test Suite

```bash
node scripts/test-ddos-detection.js all
```

See `TESTING_GUIDE.md` for detailed testing instructions.

---

## 🔄 Updates & Maintenance

### Update Dependencies

```bash
# Backend
cd backend
npm update

# Frontend
cd frontend
npm update
npm run build
```

### Database Migrations

The application handles database schema updates automatically. On first run, all tables are created. On subsequent starts, schema changes are applied automatically.

To manually reset the database:

```sql
DROP DATABASE hyperv_panel;
CREATE DATABASE hyperv_panel;
```

Then restart the backend - tables will be recreated.

### Backup & Restore

**Backup:**
```bash
mysqldump -u hyperv_panel -p hyperv_panel > backup.sql
```

**Restore:**
```bash
mysql -u hyperv_panel -p hyperv_panel < backup.sql
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style
- Add comments for complex logic
- Test thoroughly before submitting
- Update documentation as needed

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **React** - Frontend framework
- **Node.js** - Backend runtime
- **Express** - Web framework
- **MySQL** - Database
- **Tailwind CSS** - UI styling
- **Vite** - Build tool
- **Lucide Icons** - Icon library
- **node-powershell** - PowerShell integration

---

## 📞 Support

For issues, questions, or suggestions:

- 📧 Email: support@yourdomain.com
- 🐛 Issues: [GitHub Issues](https://github.com/yourusername/hyperv-panel/issues)
- 💬 Discord: [Join our server](https://discord.gg/yourserver)

---

## 🗺️ Roadmap

### Planned Features

- [ ] Multi-server support (manage multiple Hyper-V hosts)
- [ ] VM templates and cloning
- [ ] Scheduled VM operations
- [ ] Resource usage reports and analytics
- [ ] VM backup/export functionality
- [ ] Custom dashboard widgets
- [ ] REST API webhooks
- [ ] Mobile app (iOS/Android)
- [ ] Dark/Light theme toggle
- [ ] Multi-language support

---

## ⚡ Performance Tips

### For Large Deployments

1. **Enable VM Caching** - Reduces Hyper-V query load
   ```sql
   UPDATE settings SET value = '30' WHERE `key` = 'vm_cache_interval_sec';
   ```

2. **Database Indexing** - Already configured, but verify:
   ```sql
   SHOW INDEX FROM bandwidth_history;
   ```

3. **Log Rotation** - Clean up old data:
   ```sql
   DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL 90 DAY;
   DELETE FROM bandwidth_history WHERE recorded_at < NOW() - INTERVAL 7 DAY;
   ```

4. **Resource Allocation** - Increase Node.js memory:
   ```bash
   node --max-old-space-size=4096 server.js
   ```

---

---

## 📊 Statistics

- **Backend**: ~15,000 lines of JavaScript
- **Frontend**: ~8,000 lines of React/JSX
- **Database**: 20+ tables
- **API Endpoints**: 100+
- **Supported VMs**: Unlimited
- **Concurrent Users**: Tested with 50+

---

**Made with ❤️ for the Hyper-V community**

---

*Last updated: June 2026*
