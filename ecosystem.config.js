module.exports = {
    apps: [
        {
            name: 'nvr',
            max_memory_restart: '300M',
            script: '$HOME/NVR/nvr.js --time',
        },
        {
            name: 'backup',
            max_memory_restart: '300M',
            script: '$HOME/NVR/backup.js --time',
        },
    ],
}
