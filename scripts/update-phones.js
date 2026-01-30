import pool from '../config/db.js';

async function updateAdmin() {
    try {
        // Update admin user
        await pool.query(`
      UPDATE users 
      SET phone = '+998901234567', 
          first_name = 'Админ', 
          last_name = 'Система', 
          patronymic = null,
          full_name = 'Система Админ'
      WHERE id = 1
    `);
        console.log('✅ Admin updated');

        // Update test users with +7 format  
        await pool.query(`
      UPDATE users 
      SET phone = '+998901111111'
      WHERE phone = '+7 (111) 111-11-11'
    `);

        await pool.query(`
      UPDATE users 
      SET phone = '+998902222222'
      WHERE phone = '+7 (222) 222-22-22'
    `);

        console.log('✅ Test users updated');

        // Show result
        const result = await pool.query('SELECT id, phone, first_name, last_name, role FROM users');
        console.table(result.rows);

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

updateAdmin();
